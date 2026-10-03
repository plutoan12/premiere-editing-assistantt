import {spawn} from "node:child_process";

export type ProcessErrorCode="FFMPEG_NOT_FOUND"|"TIMEOUT"|"CANCELLED"|"PROCESS_FAILED";
export class ProcessRunError extends Error {
  constructor(public readonly code:ProcessErrorCode,message:string,public readonly stderr=""){super(message);this.name="ProcessRunError";}
}
export interface RunProcessOptions {timeoutMs:number;signal?:AbortSignal;maxOutputBytes?:number}
export interface ProcessResult {stdout:string;stderr:string;exitCode:number}

export function runProcess(executable:string,args:readonly string[],options:RunProcessOptions):Promise<ProcessResult>{
  if(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1) throw new Error("timeoutMs must be positive");
  const max=options.maxOutputBytes??1024*1024;
  if(!Number.isSafeInteger(max)||max<1) throw new Error("maxOutputBytes must be positive");
  if(options.signal?.aborted) return Promise.reject(new ProcessRunError("CANCELLED","process cancelled"));
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,[...args],{shell:false,stdio:["ignore","pipe","pipe"]});
    let stdout:Buffer<ArrayBufferLike>=Buffer.alloc(0),stderr:Buffer<ArrayBufferLike>=Buffer.alloc(0),forced:ProcessRunError|undefined,settled=false;
    const append=(current:Buffer<ArrayBufferLike>,chunk:Buffer<ArrayBufferLike>):Buffer<ArrayBufferLike>=>current.length>=max?current:Buffer.concat([current,chunk.subarray(0,Math.max(0,max-current.length))]);
    child.stdout.on("data",(v:Buffer)=>{stdout=append(stdout,v);});
    child.stderr.on("data",(v:Buffer)=>{stderr=append(stderr,v);});
    const kill=(error:ProcessRunError)=>{if(forced)return;forced=error;child.kill("SIGKILL");};
    const timer=setTimeout(()=>kill(new ProcessRunError("TIMEOUT",`process timed out after ${options.timeoutMs}ms`)),options.timeoutMs);
    const abort=()=>kill(new ProcessRunError("CANCELLED","process cancelled"));
    options.signal?.addEventListener("abort",abort,{once:true});
    const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener("abort",abort);};
    child.once("error",error=>{if(settled)return;settled=true;cleanup();reject(new ProcessRunError((error as NodeJS.ErrnoException).code==="ENOENT"?"FFMPEG_NOT_FOUND":"PROCESS_FAILED",error.message));});
    child.once("close",code=>{if(settled)return;settled=true;cleanup();const err=Buffer.from(stderr).toString("utf8");if(forced){reject(forced);return;}if(code!==0){reject(new ProcessRunError("PROCESS_FAILED",`process exited with code ${code}`,err));return;}resolve({stdout:Buffer.from(stdout).toString("utf8"),stderr:err,exitCode:0});});
  });
}
