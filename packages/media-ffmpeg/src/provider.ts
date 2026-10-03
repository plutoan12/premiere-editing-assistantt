import { stat } from 'node:fs/promises';
import type { ProviderContext } from '@pea/core';
import { MAX_ANALYSIS_SAMPLES, type AudioSampleProvider, type AudioSampleWindow, type SyncEvidence } from '@pea/sync';
import { INPUT_FORMATS, probeMedia, type MediaInfo } from './probe.js';
import { runProcess } from './process.js';
export interface FileSource { clipId:string; path:string; audioStream?:number; channel?:number; windowStartSeconds?:number }
export interface FfmpegOptions { sampleRate?:number; windowSeconds?:number; ffmpegPath?:string; ffprobePath?:string; timeoutMs?:number }
/** Bounded sample-exact analysis. The registered file is the selected clip (no subclip offset). */
export class FfmpegAudioProvider implements AudioSampleProvider {
  readonly id='@pea/media-ffmpeg';readonly version='sample-window-v1';
  readonly sampleRate:number;readonly sampleCount:number;
  private readonly sources=new Map<string,FileSource>();private readonly metadata=new Map<string,MediaInfo>();
  constructor(sources:readonly FileSource[],private readonly options:FfmpegOptions={}){
    this.sampleRate=options.sampleRate??8000;const seconds=options.windowSeconds??20;
    if(!Number.isSafeInteger(this.sampleRate)||this.sampleRate<1000||this.sampleRate>48000)throw new Error('sample rate must be 1000..48000');
    this.sampleCount=Math.round(seconds*this.sampleRate);
    if(!Number.isFinite(seconds)||seconds<=0||this.sampleCount<32||this.sampleCount>MAX_ANALYSIS_SAMPLES)throw new Error('analysis window exceeds sample limit');
    for(const source of sources){
      if(!source.clipId?.trim())throw new Error('clipId required');if(this.sources.has(source.clipId))throw new Error('duplicate clipId');
      if(!Number.isFinite(source.windowStartSeconds??0)||(source.windowStartSeconds??0)<0||!Number.isSafeInteger(Math.round((source.windowStartSeconds??0)*this.sampleRate)))throw new Error('invalid window start');
      for(const [label,v] of [['audio stream',source.audioStream],['channel',source.channel]] as const){if(v!==undefined&&(!Number.isSafeInteger(v)||v<0))throw new Error(`invalid ${label}`);}
      this.sources.set(source.clipId,{...source});
    }
  }
  async probe(clipId:string,context?:ProviderContext):Promise<MediaInfo>{
    const source=this.sources.get(clipId);if(!source)throw new Error('unknown clipId');
    const result=await probeMedia(source.path,{ffprobePath:this.options.ffprobePath,timeoutMs:this.options.timeoutMs,signal:context?.signal});
    this.metadata.set(clipId,result);return result;
  }
  async read(clip:SyncEvidence,context?:ProviderContext):Promise<AudioSampleWindow>{
    if(context?.signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const source=this.sources.get(clip.clipId);if(!source)throw new Error('unknown clipId');
    const meta=this.metadata.get(clip.clipId)??await this.probe(clip.clipId,context);
    const a=meta.audio[source.audioStream??0];if(!a)throw new Error('selected audio stream is missing');
    const channel=source.channel??0;if(channel>=a.channels)throw new Error('audio channel out of range');
    const start=Math.round((source.windowStartSeconds??0)*this.sampleRate);
    if(start/this.sampleRate>=meta.durationSeconds)throw new Error('analysis window is beyond end of media');
    const before=await stat(meta.path);if(before.size!==meta.size||before.mtimeMs!==meta.mtimeMs)throw new Error('source changed since probe');
    // Start from file origin: avoids codec/keyframe seek rounding. first_pts preserves initial audio silence relative to the container.
    const filter=`pan=mono|c0=c${channel},aresample=${this.sampleRate}:async=0:first_pts=0,atrim=start_sample=${start}:end_sample=${start+this.sampleCount},asetpts=N/SR/TB`;
    const {stdout}=await runProcess(this.options.ffmpegPath??'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-threads','1',
      '-copyts','-start_at_zero','-protocol_whitelist','file','-format_whitelist',INPUT_FORMATS,'-i',meta.path,
      '-map',`0:${a.index}`,'-vn','-sn','-dn','-af',filter,'-t',String(this.sampleCount/this.sampleRate),
      '-ac','1','-ar',String(this.sampleRate),'-c:a','pcm_f32le','-f','f32le','pipe:1'],
      {signal:context?.signal,timeoutMs:this.options.timeoutMs,maxStdoutBytes:this.sampleCount*4});
    const after=await stat(meta.path);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('source changed during decode');
    if(stdout.length%4)throw new Error('invalid decoded PCM byte length');
    const samples=new Float32Array(stdout.length/4);let peak=1;
    for(let i=0;i<samples.length;i++){const x=stdout.readFloatLE(i*4);if(!Number.isFinite(x))throw new Error('non-finite decoded sample');samples[i]=x;peak=Math.max(peak,Math.abs(x));}
    // One constant gain per window preserves correlation and avoids clipping resampler overshoots.
    if(peak>1)for(let i=0;i<samples.length;i++)samples[i]/=peak;
    return {samples,sampleRate:this.sampleRate,startSample:BigInt(start)};
  }
  async toolchain(context?:ProviderContext):Promise<{ffmpeg:string;ffprobe:string}>{
    const capture=async(binary:string)=>(await runProcess(binary,['-version'],{signal:context?.signal,timeoutMs:10000})).stdout.toString().split('\n')[0];
    return {ffmpeg:await capture(this.options.ffmpegPath??'ffmpeg'),ffprobe:await capture(this.options.ffprobePath??'ffprobe')};
  }
}
