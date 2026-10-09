import {writeFile,rename,rm,stat,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {runProcess} from './process-runner.js';
import {HelperError,throwIfAborted} from './errors.js';
import {LOCAL_MEDIA_FORMATS} from './media-path.js';
import {sourceFingerprint,outputDirectory} from './dsp-files.js';
import {validateMeasureInput,validateNormalizeInput,parseAudioMetadata,parseMeter,parseLoudnorm,inputArgs,meterFilter,loudnormFilter,type MeasureInput,type NormalizeInput,type MeterValues,type AudioMetadata} from './dsp-meter.js';

export interface AudioMeasurement extends MeterValues,AudioMetadata {
  schemaVersion: 1; scope: 'whole-selected-stream'; streamIndex: number; monoPolicy: MeasureInput['monoPolicy'];
  sourceSha256: string; ffmpegVersion: string; meter: 'ffmpeg-ebur128-truepeak';
}
export interface NormalizationReport {
  schemaVersion: 1; status: 'ready-for-review'|'review-required'; humanReview:'pending'; normalizationMode:'linear'|'dynamic';
  before: AudioMeasurement; after: AudioMeasurement; target: NormalizeInput['target'];
  outputPath: string; reportPath: string; warnings: string[]; integratedToleranceLu: number;
}
export interface AudioDspOptions {
  ffmpegPath?:string;ffprobePath?:string;outputRoot?:string;timeoutMs?:number;maxOutputBytes?:number;maxDurationSeconds?:number;
  runner?: typeof runProcess;
}
/** DSP only: no server or source writes. Audio Engine adaptation lives in audio-engine-provider.ts. */
export class AudioDspService {
  private readonly options: AudioDspOptions;
  constructor(options:AudioDspOptions={}) {
    this.options={...options};
    for(const [value,min,max] of [[options.timeoutMs??120000,1,3600000],[options.maxOutputBytes??536870912,65536,2147483648],[options.maxDurationSeconds??7200,1,14400]]){
      if(!Number.isSafeInteger(value)||value<min||value>max)throw new HelperError('INVALID_CONFIG','Invalid audio DSP resource limit',400);
    }
  }
  private async bounded<T>(signal:AbortSignal|undefined,work:(signal:AbortSignal,remaining:()=>number)=>Promise<T>):Promise<T>{
    throwIfAborted(signal);const controller=new AbortController();let expired=false;
    const deadline=Date.now()+(this.options.timeoutMs??120000);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(()=>{expired=true;controller.abort();},this.options.timeoutMs??120000);
    try{return await work(controller.signal,()=>Math.max(1,deadline-Date.now()));}
    catch(e){if(expired)throw new HelperError('PROCESS_TIMEOUT','Audio DSP operation timed out',504);throw e;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  private async process(exe:string,args:string[],signal:AbortSignal,remaining:()=>number,stdout=0){
    throwIfAborted(signal);
    const r=await(this.options.runner??runProcess)(exe,args,{signal,timeoutMs:remaining(),maxStdoutBytes:stdout,maxStderrBytes:1048576});
    throwIfAborted(signal);if(r.code!==0)throw new HelperError('AUDIO_DSP_FAILED','Media probe or audio DSP processing failed',422);return r;
  }
  private async measureInternal(input:MeasureInput,signal:AbortSignal,remaining:()=>number):Promise<AudioMeasurement>{
    const source=await sourceFingerprint(input.path,signal),local={...input,path:source.path};
    const probe=await this.process(this.options.ffprobePath??'ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',LOCAL_MEDIA_FORMATS,'-show_format','-show_streams','-of','json','--',source.path],signal,remaining,2097152);
    const metadata=parseAudioMetadata(probe.stdout.toString('utf8'),input.streamIndex,this.options.maxDurationSeconds??7200);
    const version=await this.process(this.options.ffmpegPath??'ffmpeg',['-version'],signal,remaining,65536);
    const result=await this.process(this.options.ffmpegPath??'ffmpeg',[...inputArgs(local),'-af',meterFilter(input.monoPolicy),'-f','null','-'],signal,remaining);
    const values=parseMeter(result.stderr.toString('utf8'));
    if(values.sampleCount/metadata.sampleRate>(this.options.maxDurationSeconds??7200))throw new HelperError('DURATION_LIMIT','Decoded audio duration limit exceeded',422);
    const after=await sourceFingerprint(input.path,signal);
    if(source.path!==after.path||source.sha256!==after.sha256)throw new HelperError('SOURCE_CHANGED','Source changed during measurement',409);
    return {...metadata,...values,durationSeconds:values.sampleCount/metadata.sampleRate,schemaVersion:1,scope:'whole-selected-stream',streamIndex:input.streamIndex,monoPolicy:input.monoPolicy,sourceSha256:source.sha256,ffmpegVersion:version.stdout.toString('utf8').split(/\r?\n/)[0],meter:'ffmpeg-ebur128-truepeak'};
  }
  async measure(value:unknown,signal?:AbortSignal):Promise<AudioMeasurement>{
    const input=validateMeasureInput(value);return this.bounded(signal,(s,r)=>this.measureInternal(input,s,r));
  }
  async normalize(value:unknown,signal?:AbortSignal):Promise<NormalizationReport>{
    const input=validateNormalizeInput(value);
    if(!this.options.outputRoot)throw new HelperError('OUTPUT_DISABLED','Configure a trusted output root before rendering',400);
    return this.bounded(signal,async(s,remaining)=>{
      let directory:string|undefined,committed=false;
      try{
        const before=await this.measureInternal(input,s,remaining);
        if(before.status!=='measured')throw new HelperError('UNMEASURABLE','Cannot normalize unmeasurable audio',422);
        if(Math.abs(before.startSeconds-before.containerStartSeconds)>1/before.sampleRate)throw new HelperError('ORIGIN_MAPPING_REQUIRED','Nonzero audio/container offset requires timeline mapping before rendering',422);
        const budget=this.options.maxOutputBytes??536870912;
        if(before.sampleCount*before.channels*4+65536>budget)throw new HelperError('OUTPUT_LIMIT','Estimated render exceeds output budget',422);
        const source=await sourceFingerprint(input.path,s),local={...input,path:source.path};
        if(source.sha256!==before.sourceSha256)throw new HelperError('SOURCE_CHANGED','Source changed before normalization',409);
        const first=await this.process(this.options.ffmpegPath??'ffmpeg',[...inputArgs(local),'-af',loudnormFilter(input.target,input.monoPolicy),'-f','null','-'],s,remaining);
        const measured=parseLoudnorm(first.stderr.toString('utf8'));
        const wouldBeDynamic=measured.range>input.target.loudnessRangeLu||measured.peak+input.target.integratedLufs-measured.integrated>input.target.truePeakDbtp;
        if(wouldBeDynamic&&!input.allowDynamic)throw new HelperError('DYNAMIC_APPROVAL_REQUIRED','Dynamic normalization needs explicit approval',409);
        throwIfAborted(s);directory=await outputDirectory(this.options.outputRoot!);throwIfAborted(s);
        const working=join(directory,'processing.wav');
        const rendered=await this.process(this.options.ffmpegPath??'ffmpeg',[...inputArgs(local),'-af',loudnormFilter(input.target,input.monoPolicy,measured),'-ar',String(before.sampleRate),'-c:a','pcm_f32le','-map_metadata','-1','-fs',String(budget),'-f','wav','-n',working],s,remaining);
        const actual=parseLoudnorm(rendered.stderr.toString('utf8'));
        if(actual.mode==='dynamic'&&!input.allowDynamic)throw new HelperError('DYNAMIC_APPROVAL_REQUIRED','Actual normalization switched to dynamic without approval',409);
        if((await stat(working)).size>budget)throw new HelperError('OUTPUT_LIMIT','Render exceeded output budget',422);
        const after=await this.measureInternal({path:working,streamIndex:0,monoPolicy:input.monoPolicy},s,remaining);
        if(after.sampleCount!==before.sampleCount||after.sampleRate!==before.sampleRate||after.channels!==before.channels||after.channelLayout!==before.channelLayout)throw new HelperError('AUDIO_SHAPE_CHANGED','Rendered audio sample count, rate or channel layout changed',422);
        const finalSource=await sourceFingerprint(input.path,s);
        if(source.path!==finalSource.path||source.sha256!==finalSource.sha256)throw new HelperError('SOURCE_CHANGED','Source changed during normalization',409);
        const warnings:string[]=[];
        if(after.integratedLufs===null||Math.abs(after.integratedLufs-input.target.integratedLufs)>0.5)warnings.push('INTEGRATED_TARGET_NOT_MET');
        if(after.truePeakDbtp===null||after.truePeakDbtp>input.target.truePeakDbtp)warnings.push('TRUE_PEAK_TARGET_NOT_MET');
        if(after.loudnessRangeLu>input.target.loudnessRangeLu+0.5)warnings.push('LOUDNESS_RANGE_TARGET_NOT_MET');
        const outputPath=join(directory,'normalized.wav'),reportPath=join(directory,'report.json');
        const report:NormalizationReport={schemaVersion:1,status:warnings.length?'review-required':'ready-for-review',humanReview:'pending',normalizationMode:actual.mode,before,after,target:{...input.target},outputPath,reportPath,warnings,integratedToleranceLu:0.5};
        throwIfAborted(s);await chmod(working,0o600);await rename(working,outputPath);
        await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});throwIfAborted(s);
        committed=true;return report;
      }finally{if(directory&&!committed)await rm(directory,{recursive:true,force:true});}
    });
  }
}
