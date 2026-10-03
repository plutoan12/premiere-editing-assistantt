import {spawn} from 'node:child_process';
export interface ProcessResult{code:number;stdout:Buffer;stderr:Buffer}
export interface RunOptions{signal?:AbortSignal;timeoutMs:number;maxStdoutBytes:number;maxStderrBytes?:number}
export async function runProcess(executable:string,args:readonly string[],options:RunOptions):Promise<ProcessResult>{
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,[...args],{shell:false,stdio:['ignore','pipe','pipe']});const out:Buffer[]=[],err:Buffer[]=[];let outN=0,errN=0,done=false;
  const finish=(error?:Error,result?:ProcessResult)=>{if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);error?reject(error):resolve(result!)};
  const kill=(why:string)=>{child.kill('SIGKILL');finish(new Error(why))}; const abort=()=>kill('process cancelled');
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)return abort();
  const timer=setTimeout(()=>kill('process timeout'),options.timeoutMs);
  child.stdout.on('data',(b:Buffer)=>{outN+=b.length;if(outN>options.maxStdoutBytes)return kill('stdout limit exceeded');out.push(b)});
  child.stderr.on('data',(b:Buffer)=>{errN+=b.length;if(errN>(options.maxStderrBytes??262144))return kill('stderr limit exceeded');err.push(b)});
  child.once('error',e=>finish(e));child.once('close',code=>{if(done)return;finish(undefined,{code:code??-1,stdout:Buffer.concat(out),stderr:Buffer.concat(err)})});
 });
}
