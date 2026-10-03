import { spawn } from 'node:child_process';
export interface ProcessOptions { signal?:AbortSignal; timeoutMs?:number; maxStdoutBytes?:number; maxStderrBytes?:number }
/** No shell, no unbounded buffering. Cancellation terminates the actual child. */
export function runProcess(binary:string,args:readonly string[],options:ProcessOptions={}):Promise<{stdout:Buffer;stderr:string}> {
  const timeout=options.timeoutMs??60000,maxOut=options.maxStdoutBytes??1048576,maxErr=options.maxStderrBytes??65536;
  for(const n of [timeout,maxOut,maxErr]) if(!Number.isSafeInteger(n)||n<=0) throw new Error('invalid process limit');
  if(options.signal?.aborted) return Promise.reject(new DOMException('Cancelled','AbortError'));
  return new Promise((resolve,reject)=>{
    let child:ReturnType<typeof spawn>;
    try{child=spawn(binary,[...args],{shell:false,stdio:['ignore','pipe','pipe'],windowsHide:true});}catch(e){reject(e);return;}
    const chunks:Buffer[]=[],logs:Buffer[]=[];let count=0,logCount=0,failure:Error|undefined,settled=false;
    let killTimer:ReturnType<typeof setTimeout>|undefined;
    const cleanup=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);options.signal?.removeEventListener('abort',abort);};
    const stop=(error:Error)=>{if(failure||settled)return;failure=error;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),200);};
    const abort=()=>stop(new DOMException('Cancelled','AbortError'));
    const timer=setTimeout(()=>stop(new Error(`process timed out after ${timeout}ms`)),timeout);
    options.signal?.addEventListener('abort',abort,{once:true});
    child.stdout!.on('data',(chunk:Buffer)=>{count+=chunk.length;if(count>maxOut)stop(new Error('stdout byte limit exceeded'));else chunks.push(chunk);});
    child.stderr!.on('data',(chunk:Buffer)=>{const remaining=maxErr-logCount;if(remaining>0){const part=chunk.subarray(0,remaining);logs.push(part);logCount+=part.length;}});
    child.on('error',error=>{if(settled)return;settled=true;cleanup();reject(failure??error);});
    child.on('close',(code,signal)=>{
      if(settled)return;settled=true;cleanup();const stderr=Buffer.concat(logs).toString('utf8');
      if(failure)reject(failure);else if(code!==0)reject(new Error(`${binary} exit ${code} (${signal??'no signal'}): ${stderr}`));
      else resolve({stdout:Buffer.concat(chunks),stderr});
    });
    if(options.signal?.aborted)abort();
  });
}
