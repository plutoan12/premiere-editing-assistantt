import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateDescriptor, validateWindow, decodePcm, type MediaProvider, type MediaDescriptor, type PcmResponse, type WindowRequest } from '@pea/rough-media/wire';
type State = 'queued'|'running'|'completed'|'failed'|'cancelled';
interface Job { id:string; status:State; controller:AbortController; task?:Promise<void>; media?:MediaDescriptor; pcm?:PcmResponse; error?:string; }
function send(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(value));}
async function body(req:IncomingMessage,limit:number):Promise<any>{
 const chunks:Buffer[]=[];let count=0;for await(const c of req){const b=Buffer.from(c);count+=b.length;if(count>limit)throw Object.assign(Error('request body limit'),{status:413});chunks.push(b);}
 const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!v||typeof v!=='object'||Array.isArray(v))throw Error('JSON object required');return v;
}
/** Called ONLY after the existing helper Bearer authentication check. */
export function createAudioRoutes(provider:MediaProvider,options:{maxBodyBytes?:number}={}){
 const jobs=new Map<string,Job>(),known=new Map<string,MediaDescriptor>();let running=0,closed=false,retained=0;
 const maxBody=options.maxBodyBytes??65536;
 function submit(work:(job:Job)=>Promise<void>):Job{
  if(closed||running>=1||jobs.size>=16)throw Object.assign(Error('audio job capacity; cancel/delete completed jobs'),{status:429});
  const job:Job={id:randomBytes(16).toString('hex'),status:'queued',controller:new AbortController()};jobs.set(job.id,job);running++;
  job.task=Promise.resolve().then(async()=>{try{if(job.controller.signal.aborted){job.status='cancelled';return;}job.status='running';await work(job);if(job.controller.signal.aborted){job.pcm=undefined;job.media=undefined;job.status='cancelled';}else job.status='completed';}catch(e){job.status=job.controller.signal.aborted?'cancelled':'failed';job.error=e instanceof Error?e.message:'audio operation failed';}finally{running--;}});
  return job;
 }
 return{
  async handle(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
   const path=new URL(req.url??'/','http://127.0.0.1').pathname;
   if(!['/v1/media/probe','/v1/audio/window'].includes(path)&&!path.startsWith('/v1/audio/jobs/'))return false;
   try{
    if(req.method==='POST'&&(path==='/v1/media/probe'||path==='/v1/audio/window')){
     const b=await body(req,maxBody);
     if(path==='/v1/media/probe'){
      if(typeof b.path!=='string'||!b.path.startsWith('/')||b.path.includes('\0'))throw Error('local source path required');
      const job=submit(async j=>{const m=validateDescriptor(await provider.probe(b.path,j.controller.signal));if(j.controller.signal.aborted)return;j.media=m;if(known.size>=16&&!known.has(m.path))known.delete(known.keys().next().value!);known.set(m.path,{...m,frameRate:{...m.frameRate}});});
      send(res,202,{jobId:job.id});return true;
     }
     validateWindow(b as WindowRequest);
     const saved=known.get(b.media.path);if(!saved||JSON.stringify(saved)!==JSON.stringify(b.media)){send(res,409,{error:'source must be probed by this helper session'});return true;}
     const job=submit(async j=>{
      const pcm=await provider.readWindow(b,j.controller.signal);if(j.controller.signal.aborted)return;
      if(pcm.meta.startSample!==b.startSample||pcm.meta.sampleCount!==b.sampleCount||pcm.meta.fileIdentity!==saved.fileIdentity||pcm.meta.channels!==saved.channels)throw Error('PCM provider metadata mismatch');
      decodePcm(pcm.data,pcm.meta);
      if(retained+pcm.data.byteLength>32*1024*1024)throw Error('retained PCM limit; delete completed jobs');
      retained+=pcm.data.byteLength;j.pcm=pcm;
     });send(res,202,{jobId:job.id});return true;
    }
    const match=/^\/v1\/audio\/jobs\/([a-f0-9]{32})(\/cancel|\/pcm)?$/.exec(path),job=match?jobs.get(match[1]):undefined;
    if(!match||!job){send(res,404,{error:'audio job not found'});return true;}
    if(req.method==='GET'&&!match[2]){send(res,200,{id:job.id,status:job.status,...(job.media?{media:job.media}:{}),...(job.pcm?{pcm:job.pcm.meta}:{}),...(job.error?{error:job.error}:{})});return true;}
    if(req.method==='GET'&&match[2]==='/pcm'){
     if(job.status!=='completed'||!job.pcm){send(res,409,{error:'PCM not ready'});return true;}
     res.writeHead(200,{'content-type':'application/octet-stream','content-length':job.pcm.data.byteLength,'cache-control':'no-store','access-control-allow-origin':'*','access-control-expose-headers':'x-pea-pcm','x-pea-pcm':JSON.stringify(job.pcm.meta)});res.end(Buffer.from(job.pcm.data));return true;
    }
    if(req.method==='POST'&&match[2]==='/cancel'){
     if(job.status==='queued'||job.status==='running'){job.controller.abort();job.status='cancelled';}
     send(res,200,{status:job.status});return true;
    }
    if(req.method==='DELETE'&&!match[2]){
     if(job.status==='queued'||job.status==='running'){send(res,409,{error:'cancel running job first'});return true;}
     await job.task;if(job.pcm)retained-=job.pcm.data.byteLength;jobs.delete(job.id);send(res,200,{deleted:true});return true;
    }
    send(res,405,{error:'unsupported audio method'});return true;
   }catch(e){send(res,e&&typeof e==='object'&&'status'in e?Number(e.status):400,{error:e instanceof Error?e.message:'invalid audio request'});return true;}
  },
  async stop(){closed=true;for(const j of jobs.values())j.controller.abort();await Promise.allSettled([...jobs.values()].map(j=>j.task));jobs.clear();known.clear();retained=0;},
 };
}
