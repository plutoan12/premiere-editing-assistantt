import {runProcess,type ProcessResult,type RunOptions} from './process-runner.js';
export interface MediaProbe{durationSeconds:number|null;audioStreams:{index?:number;codec?:string;sampleRate?:number;channels?:number}[];videoStreams:{index?:number;codec?:string}[]}
export type Runner=(exe:string,args:readonly string[],options:RunOptions)=>Promise<ProcessResult>;
export function buildProbeArgs(path:string):string[]{return ['-v','error','-show_format','-show_streams','-of','json','--',path]}
export async function probeMedia(path:string,options:{ffprobePath?:string;runner?:Runner;signal?:AbortSignal;timeoutMs?:number}={}):Promise<MediaProbe>{
 if(typeof path!=='string'||!path.trim())throw new Error('media path required');
 const result=await (options.runner??runProcess)(options.ffprobePath??'ffprobe',buildProbeArgs(path),{signal:options.signal,timeoutMs:options.timeoutMs??10000,maxStdoutBytes:2*1024*1024});
 if(result.code!==0)throw new Error(`ffprobe failed: ${result.stderr.toString('utf8').slice(0,1000)}`);
 let raw:any;try{raw=JSON.parse(result.stdout.toString('utf8'))}catch{throw new Error('invalid ffprobe JSON')}
 const streams=Array.isArray(raw.streams)?raw.streams:[];
 return {durationSeconds:Number.isFinite(Number(raw.format?.duration))?Number(raw.format.duration):null,
  audioStreams:streams.filter((s:any)=>s.codec_type==='audio').map((s:any)=>({index:s.index,codec:s.codec_name,sampleRate:Number(s.sample_rate)||undefined,channels:s.channels})),
  videoStreams:streams.filter((s:any)=>s.codec_type==='video').map((s:any)=>({index:s.index,codec:s.codec_name}))};
}
