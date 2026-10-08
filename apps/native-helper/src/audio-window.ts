import {createHash,randomUUID} from "node:crypto";
import {mkdir,readFile,rm,stat} from "node:fs/promises";
import {resolve,join} from "node:path";
import {probeMedia,HelperError} from "./ffmpeg.js";
import {runProcess,ProcessRunError} from "./process-runner.js";

export interface DecodeAudioWindowOptions {
 ffmpegPath?:string;ffprobePath?:string;cacheDir:string;startSeconds:number;durationSeconds:number;sampleRate:number;maxSamples?:number;timeoutMs?:number;signal?:AbortSignal;env?:NodeJS.ProcessEnv
}
export interface AudioArtifact {path:string;sampleRate:number;startSample:bigint;sampleCount:number;channelPolicy:"mono-average";sha256:string}
export async function decodeAudioWindow(path:string,o:DecodeAudioWindowOptions):Promise<AudioArtifact>{
 if(!Number.isFinite(o.startSeconds)||o.startSeconds<0||!Number.isFinite(o.durationSeconds)||o.durationSeconds<=0||!Number.isSafeInteger(o.sampleRate)||o.sampleRate<=0) throw new HelperError("INVALID_WINDOW","invalid audio window");
 const max=o.maxSamples??262144,requested=Math.ceil(o.durationSeconds*o.sampleRate);
 if(!Number.isSafeInteger(max)||max<1||requested>max) throw new HelperError("WINDOW_TOO_LARGE",`requested ${requested} samples exceeds ${max}`);
 await probeMedia(path,{ffprobePath:o.ffprobePath,timeoutMs:o.timeoutMs??10000,signal:o.signal});
 await mkdir(o.cacheDir,{recursive:true});
 const output=join(resolve(o.cacheDir),`${randomUUID()}.f32le`);
 const executable=o.ffmpegPath??process.env.PEA_FFMPEG_PATH??"ffmpeg";
 try{
  await runProcess(executable,["-nostdin","-v","error","-ss",String(o.startSeconds),"-t",String(o.durationSeconds),"-i",resolve(path),"-map","0:a:0","-vn","-ac","1","-ar",String(o.sampleRate),"-f","f32le","-y",output],{timeoutMs:o.timeoutMs??30000,signal:o.signal,maxOutputBytes:256*1024,env:o.env});
  const info=await stat(output); if(info.size%4!==0) throw new HelperError("CORRUPT_MEDIA","decoded PCM byte length is not float32 aligned");
  const sampleCount=info.size/4;if(sampleCount>max) throw new HelperError("WINDOW_TOO_LARGE","decoder produced too many samples");
  const bytes=await readFile(output);const sha256=createHash("sha256").update(bytes).digest("hex");
  return {path:output,sampleRate:o.sampleRate,startSample:BigInt(Math.round(o.startSeconds*o.sampleRate)),sampleCount,channelPolicy:"mono-average",sha256};
 }catch(error){
  await rm(output,{force:true});
  if(error instanceof HelperError) throw error;
  if(error instanceof ProcessRunError) throw new HelperError(error.code,error.message);
  throw error;
 }
}
