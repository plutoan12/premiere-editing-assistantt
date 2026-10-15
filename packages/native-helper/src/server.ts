import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { MediaService } from './media.js';
import { JobQueue, type JobSnapshot } from './jobs.js';
import { executeSync, parseSyncRequest } from './sync-job.js';
import { HELPER_VERSION, PROTOCOL_VERSION, json, object, text } from './protocol.js';
import { HelperError, publicError } from './errors.js';
export interface HelperServer {url:string;token:string;close():Promise<void>}
export interface ServerConfig {media:MediaService;allowedOrigins?:readonly string[]}
const BODY_LIMIT=65536;
const EXPOSE='X-PEA-Sample-Rate, X-PEA-Start-Sample, X-PEA-Sample-Count, X-PEA-PCM-SHA256, X-PEA-Stream, X-PEA-Channel';
function send(res:ServerResponse,status:number,value?:unknown):void{
  res.statusCode=status;if(value===undefined){res.end();return;}
  const body=json(value);res.setHeader('Content-Type','application/json');res.setHeader('Content-Length',Buffer.byteLength(body));res.end(body);
}
async function readJson(req:IncomingMessage):Promise<unknown>{
  if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json'||req.headers['content-encoding']){
    throw new HelperError('INVALID_REQUEST','Use uncompressed application/json',415);
  }
  return new Promise((resolve,reject)=>{
    let length=0;const chunks:Buffer[]=[];let done=false;
    const finish=(error?:Error)=>{
      if(done)return;done=true;req.off('data',onData);req.off('end',onEnd);req.off('aborted',onAbort);req.off('error',onError);
      if(error){req.resume();reject(error);}else{
        try{resolve(JSON.parse(Buffer.concat(chunks,length).toString('utf8')));}catch{reject(new HelperError('INVALID_JSON','Malformed JSON request'));}
      }
    };
    const onData=(chunk:Buffer)=>{length+=chunk.length;if(length>BODY_LIMIT)finish(new HelperError('BODY_LIMIT','JSON request exceeds 64 KiB',413));else chunks.push(chunk);};
    const onEnd=()=>finish();const onAbort=()=>finish(new DOMException('Request cancelled','AbortError'));
    const onError=()=>finish(new HelperError('INVALID_REQUEST','Request stream failed'));
    req.on('data',onData);req.once('end',onEnd);req.once('aborted',onAbort);req.once('error',onError);
  });
}
export async function startHelper(config:ServerConfig):Promise<HelperServer>{
  const origins=new Set(config.allowedOrigins??[]);
  for(const origin of origins){
    let parsed:URL;try{parsed=new URL(origin);}catch{throw new HelperError('INVALID_ORIGIN','Invalid allowed browser origin');}
    if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)throw new HelperError('INVALID_ORIGIN','Use an exact HTTP(S) browser origin');
  }
  const token=randomBytes(32).toString('hex'),expected=Buffer.from(`Bearer ${token}`);
  const queue=new JobQueue(),shutdown=new AbortController(),tasks=new Set<Promise<void>>();
  let host='',inFlight=0,directWork=0,closing:Promise<void>|undefined;
  const authorize=(req:IncomingMessage,res:ServerResponse):void=>{
    if(req.headers.host!==host)throw new HelperError('HOST_FORBIDDEN','Unexpected Host header',403);
    const origin=req.headers.origin;
    if(origin!==undefined){
      if(!origins.has(origin))throw new HelperError('ORIGIN_FORBIDDEN','Browser origin is not allowed',403);
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Expose-Headers',EXPOSE);
    }
  };
  const direct=async<T>(work:()=>Promise<T>):Promise<T>=>{
    if(directWork>=2)throw new HelperError('HELPER_BUSY','Two media requests are already running; retry later',429);
    directWork++;try{return await work();}finally{directWork--;}
  };
  const handle=async(req:IncomingMessage,res:ServerResponse):Promise<void>=>{
    const cancelled=new AbortController();const signal=AbortSignal.any([cancelled.signal,shutdown.signal]);
    res.once('close',()=>{if(!res.writableEnded)cancelled.abort();});
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    let counted=false;
    try{
      authorize(req,res);
      if(shutdown.signal.aborted)throw new HelperError('SHUTTING_DOWN','Helper is shutting down',503);
      const path=req.url??'';
      if(!path.startsWith('/')||path.startsWith('//')||path.includes('?')||path.includes('#'))throw new HelperError('INVALID_REQUEST','Unsupported request URL');
      if(req.method==='OPTIONS'){
        if(!req.headers.origin||!['GET','POST','DELETE'].includes(req.headers['access-control-request-method']??''))throw new HelperError('ORIGIN_FORBIDDEN','Unsupported preflight',403);
        const requested=(req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
        if(requested.some(h=>!['authorization','content-type','x-pea-protocol'].includes(h)))throw new HelperError('ORIGIN_FORBIDDEN','Unsupported preflight headers',403);
        res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-PEA-Protocol');send(res,204);return;
      }
      if(req.method==='GET'&&path==='/health'){send(res,200,{helperVersion:HELPER_VERSION,protocolVersion:PROTOCOL_VERSION,capabilities:['probe','audio-window','sync']});return;}
      const auth=Buffer.from(req.headers.authorization??'');
      const duplicates=req.rawHeaders.filter((_,i)=>i%2===0).filter(h=>h.toLowerCase()==='authorization').length;
      if(duplicates!==1||auth.length!==expected.length||!timingSafeEqual(auth,expected))throw new HelperError('UNAUTHORIZED','A valid session token is required',401);
      if(req.headers['x-pea-protocol']!==String(PROTOCOL_VERSION))throw new HelperError('PROTOCOL_MISMATCH','Helper protocol version 1 is required',409);
      if(inFlight>=16)throw new HelperError('HELPER_BUSY','Too many active requests',429);
      inFlight++;counted=true;
      if(req.method==='POST'&&path==='/v1/media/probe'){
        const r=object(await readJson(req),['path']);const file=text(r.path,'media path',4096);
        send(res,200,await direct(()=>config.media.register(file,signal)));return;
      }
      if(req.method==='POST'&&path==='/v1/audio/window'){
        const r=object(await readJson(req),['assetId','window']);const assetId=text(r.assetId,'asset ID',128);
        const result=await direct(()=>config.media.read(assetId,r.window??{},signal));
        res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Length',result.pcm.length);
        res.setHeader('X-PEA-Sample-Rate',result.window.sampleRate);res.setHeader('X-PEA-Start-Sample',result.window.startSample.toString());
        res.setHeader('X-PEA-Sample-Count',result.window.samples.length);res.setHeader('X-PEA-PCM-SHA256',result.sha256);
        res.setHeader('X-PEA-Stream',result.policy.stream);res.setHeader('X-PEA-Channel',result.policy.channel);res.end(result.pcm);return;
      }
      if(req.method==='POST'&&path==='/v1/jobs'){
        const request=parseSyncRequest(await readJson(req));for(const c of request.clips)config.media.info(c.assetId);
        const created:JobSnapshot=queue.submit((s,p)=>executeSync(created.id,request,config.media,s,p));send(res,202,created);return;
      }
      const match=/^\/v1\/jobs\/([0-9a-f-]{36})(\/cancel)?$/.exec(path);
      if(match){
        if(req.method==='GET'&&!match[2]){send(res,200,queue.get(match[1]));return;}
        if(req.method==='POST'&&match[2]){send(res,200,queue.cancel(match[1]));return;}
        if(req.method==='DELETE'&&!match[2]){queue.remove(match[1]);send(res,204);return;}
      }
      throw new HelperError('NOT_FOUND','Unsupported endpoint',404);
    }catch(error){
      const safe=publicError(error);if(!res.headersSent&&!res.destroyed){res.setHeader('Connection','close');send(res,safe.status,{error:{code:safe.code,message:safe.message}});}
    }finally{if(counted)inFlight--;}
  };
  const server=createServer((req,res)=>{
    const task=handle(req,res).catch(()=>{res.destroy();}).finally(()=>tasks.delete(task));tasks.add(task);
  });
  server.maxConnections=32;server.requestTimeout=10000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  const address=server.address() as AddressInfo;host=`127.0.0.1:${address.port}`;
  return {url:`http://${host}`,token,close(){
    closing??=(async()=>{
      shutdown.abort();const jobs=queue.close();
      const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();
      await Promise.allSettled([...tasks,jobs,closed]);
    })();return closing;
  }};
}
