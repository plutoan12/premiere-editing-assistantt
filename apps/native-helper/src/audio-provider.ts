import type {ProviderContext} from '@pea/core';
import type {AudioSampleProvider,AudioSampleWindow,SyncEvidence} from '@pea/sync';
import {MAX_ANALYSIS_SAMPLES} from '@pea/sync';
import {runProcess,type ProcessResult,type RunOptions} from './process-runner.js';
import type {Runner} from './ffmpeg.js';

export interface AudioWindowRequest{startSample:bigint;maxSamples:number;signal?:AbortSignal}
export function buildAudioArgs(path:string,sampleRate:number,startSample:bigint,maxSamples:number):string[]{
 const start=Number(startSample)/sampleRate,duration=maxSamples/sampleRate;
 return ['-v','error','-ss',start.toFixed(9),'-i',path,'-t',duration.toFixed(9),'-map','0:a:0','-ac','1','-ar',String(sampleRate),'-sample_fmt','flt','-f','f32le','pipe:1'];
}
export class FfmpegAudioSampleProvider implements AudioSampleProvider{
 readonly id='ffmpeg-local';readonly version='1';
 constructor(private readonly options:{resolvePath:(clip:SyncEvidence)=>string;runner?:Runner;ffmpegPath?:string;sampleRate?:number}){}
 async read(clip:SyncEvidence,ctx?:ProviderContext):Promise<AudioSampleWindow>{
   return this.readWindow(clip,{startSample:0n,maxSamples:MAX_ANALYSIS_SAMPLES,signal:ctx?.signal});
 }
 async readWindow(clip:SyncEvidence,request:AudioWindowRequest):Promise<AudioSampleWindow>{
  const rate=this.options.sampleRate??8000;
  if(!Number.isSafeInteger(request.maxSamples)||request.maxSamples<=0||request.maxSamples>MAX_ANALYSIS_SAMPLES)throw new Error('invalid max sample count');
  if(typeof request.startSample!=='bigint'||request.startSample<0n)throw new Error('invalid start sample');
  const result=await (this.options.runner??runProcess)(this.options.ffmpegPath??'ffmpeg',buildAudioArgs(this.options.resolvePath(clip),rate,request.startSample,request.maxSamples),{signal:request.signal,timeoutMs:30000,maxStdoutBytes:request.maxSamples*4});
  if(result.code!==0)throw new Error(`ffmpeg failed: ${result.stderr.toString('utf8').slice(0,1000)}`);
  if(result.stdout.length%4!==0||result.stdout.length/4>request.maxSamples)throw new Error('invalid PCM output size');
  const samples=new Float32Array(result.stdout.length/4);for(let i=0;i<samples.length;i++){const v=result.stdout.readFloatLE(i*4);if(!Number.isFinite(v)||Math.abs(v)>1)throw new Error('invalid normalized PCM');samples[i]=v}
  return {samples,sampleRate:rate,startSample:request.startSample};
 }
}
