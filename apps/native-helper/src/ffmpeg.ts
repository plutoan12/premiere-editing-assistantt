import {resolve} from "node:path";
import {runProcess,ProcessRunError,type ProcessErrorCode} from "./process-runner.js";

export type HelperErrorCode=ProcessErrorCode|"NO_AUDIO"|"CORRUPT_MEDIA";
export class HelperError extends Error {constructor(public readonly code:HelperErrorCode,message:string){super(message);this.name="HelperError";}}
export interface ProbeOptions {ffprobePath?:string;timeoutMs?:number;signal?:AbortSignal}
export interface MediaProbe {durationSeconds:number;audio:{streamIndex:number;codec:string;sampleRate:number;channels:number}}

export async function probeMedia(path:string,options:ProbeOptions={}):Promise<MediaProbe>{
  const executable=options.ffprobePath??process.env.PEA_FFPROBE_PATH??"ffprobe";
  let result;
  try{result=await runProcess(executable,["-v","error","-print_format","json","-show_format","-show_streams",resolve(path)],{timeoutMs:options.timeoutMs??10000,signal:options.signal,maxOutputBytes:2*1024*1024});}
  catch(error){if(error instanceof ProcessRunError) throw new HelperError(error.code,error.message);throw error;}
  let parsed:any;
  try{parsed=JSON.parse(result.stdout);}catch{throw new HelperError("CORRUPT_MEDIA","ffprobe returned invalid JSON");}
  const stream=Array.isArray(parsed?.streams)?parsed.streams.find((x:any)=>x?.codec_type==="audio"):undefined;
  if(!stream) throw new HelperError("NO_AUDIO","media has no audio stream");
  const duration=Number(parsed?.format?.duration),sampleRate=Number(stream.sample_rate),channels=Number(stream.channels);
  if(!Number.isFinite(duration)||duration<0||!Number.isSafeInteger(sampleRate)||sampleRate<=0||!Number.isSafeInteger(channels)||channels<=0) throw new HelperError("CORRUPT_MEDIA","ffprobe metadata is incomplete");
  return {durationSeconds:duration,audio:{streamIndex:Number(stream.index),codec:String(stream.codec_name??"unknown"),sampleRate,channels}};
}
