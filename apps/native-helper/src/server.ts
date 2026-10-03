import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createServer as createSecureServer} from 'node:https';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {AudioSampleWindow} from '@pea/sync';
import {HELPER_PROTOCOL_VERSION} from './protocol.js';
import {probeMedia,type MediaProbe} from './ffmpeg.js';
import {FfmpegAudioSampleProvider,validateWindowRequest,type AudioWindowRequest} from './audio-provider.js';
import {validateLocalPath} from './media-path.js';
import {JobRegistry} from './jobs.js';
import {HelperError,publicError,throwIfAborted} from './errors.js';
import {binaryAudio,exactKeys,json,object,pcmBytes,readJson} from './http-codec.js';
import {validateSyncInput,runSyncJob} from './sync-job.js';

export interface HelperServer {address:string;sessionToken:string;close():Promise<void>}
export interface HelperServerOptions {
  host:string;port:number;sessionToken?:string;ffmpegPath?:string;ffprobePath?:string;
  tls?:{key:Buffer|string;cert:Buffer|string};
  probe?:(path:string,signal?:AbortSignal)=>Promise<MediaProbe>;
  audio?:(path:string,request:AudioWindowRequest,sampleRate:number)=>Promise<AudioSampleWindow>;
}
function authorized(req:IncomingMessage,token:string):boolean {
  const raw=req.headers.authorization;if(!raw?.startsWith('Bearer '))return false;
  const supplied=Buffer.from(raw.slice(7)),expected=Buffer.from(token);
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
function pathInput(input:Record<string,unknown>):string {
  if(typeof input.path!=='string')throw new HelperError('INVALID_PATH','Local path required',400);
  validateLocalPath(input.path);return input.path;
}
function windowInput(input:Record<string,unknown>) {
  exactKeys(input,['path','startSample','maxSamples','sampleRate']);const path=pathInput(input);
  if(typeof input.startSample!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(input.startSample)||typeof input.maxSamples!=='number'||
    (input.sampleRate!==undefined&&typeof input.sampleRate!=='number'))throw new HelperError('INVALID_WINDOW','Use decimal startSample and integer maxSamples/sampleRate',400);
  const request={startSample:BigInt(input.startSample),maxSamples:input.maxSamples};
  const rate=(input.sampleRate as number|undefined)??8000;validateWindowRequest(rate,request);return {path,request,rate};
}
export async function createHelperServer(options:HelperServerOptions):Promise<HelperServer> {
  if(options.host!=='127.0.0.1')throw new HelperError('INVALID_CONFIG','Helper must bind to IPv4 loopback 127.0.0.1',400);
  if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw new HelperError('INVALID_CONFIG','Invalid port',400);
  const sessionToken=options.sessionToken??randomBytes(32).toString('hex');
  if(!/^[\x21-\x7e]{1,512}$/.test(sessionToken))throw new HelperError('INVALID_CONFIG','Invalid session token',400);
  if(options.tls&&(!options.tls.key?.length||!options.tls.cert?.length))throw new HelperError('INVALID_TLS','Both TLS certificate and private key are required',400);
  const jobs=new JobRegistry(),controllers=new Set<AbortController>(),operations=new Set<Promise<unknown>>();
  let closing=false;
  const probe=options.probe??((path,signal)=>probeMedia(path,{signal,ffprobePath:options.ffprobePath}));
  const audio=options.audio??((path,request,rate)=>new FfmpegAudioSampleProvider({resolvePath:()=>path,sampleRate:rate,ffmpegPath:options.ffmpegPath,ffprobePath:options.ffprobePath}).readWindow({clipId:'local-media'},request));
  async function limited<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T> {
    throwIfAborted(signal);
    if(closing)throw new HelperError('CLOSING','Helper is stopping',503);
    if(operations.size>=2)throw new HelperError('BUSY','Two media operations are already running',429);
    const operation=Promise.resolve().then(work);operations.add(operation);
    try{return await operation;}finally{operations.delete(operation);}
  }
  const handle=async(req:IncomingMessage,res:ServerResponse)=>{
    const controller=new AbortController();controllers.add(controller);req.on('error',()=>{});
    req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort()});
    try {
      const address=server.address();
      const expectedHost=address&&typeof address!=='string'?`127.0.0.1:${address.port}`:'';
      if(req.headers.host!==expectedHost||req.headers.origin!==undefined)throw new HelperError('FORBIDDEN_ORIGIN','Only the local native client is allowed',403);
      if(!req.url?.startsWith('/')||req.url.length>4096)throw new HelperError('INVALID_REQUEST','Invalid route',400);
      const url=new URL(req.url,'http://127.0.0.1');
      if(closing)throw new HelperError('CLOSING','Helper is stopping',503);
      if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,protocolVersion:HELPER_PROTOCOL_VERSION,helperVersion:'0.1.2'});
      if(url.pathname.startsWith('/v1/')&&!authorized(req,sessionToken))throw new HelperError('UNAUTHORIZED','Invalid session token',401);
      if(req.headers['x-pea-protocol-version']!==undefined&&req.headers['x-pea-protocol-version']!=='1')throw new HelperError('PROTOCOL_MISMATCH','Helper protocol version 1 is required',409);
      if(req.method==='GET'&&url.pathname==='/v1/ping')return json(res,200,{ok:true,protocolVersion:HELPER_PROTOCOL_VERSION,capabilities:['media-probe','audio-window','sync']});
      if(req.method==='POST'&&url.pathname==='/v1/media/probe') {
        const input=await readJson(req);exactKeys(input,['path']);const path=pathInput(input);
        return json(res,200,await limited(()=>probe(path,controller.signal),controller.signal));
      }
      if(req.method==='POST'&&url.pathname==='/v1/audio/window') {
        const {path,request,rate}=windowInput(await readJson(req));
        return binaryAudio(res,await limited(()=>audio(path,{...request,signal:controller.signal},rate),controller.signal));
      }
      if(req.method==='POST'&&url.pathname==='/v1/jobs') {
        const body=await readJson(req);exactKeys(body,['kind','input']);const input=object(body.input);let id:string;
        if(body.kind==='media-probe') {
          exactKeys(input,['path']);const path=pathInput(input);id=jobs.submit('media-probe',signal=>limited(()=>probe(path,signal),signal));
        }else if(body.kind==='audio-window') {
          const {path,request,rate}=windowInput(input);
          id=jobs.submit('audio-window',signal=>limited(async()=>{const window=await audio(path,{...request,signal},rate);pcmBytes(window);return window;},signal));
        }else if(body.kind==='sync') {
          const request=validateSyncInput(input);id=jobs.submit('sync',signal=>limited(()=>runSyncJob(request,audio,signal),signal));
        }else throw new HelperError('INVALID_JOB','Unsupported job kind',400);
        return json(res,202,{id,kind:body.kind,status:'queued'});
      }
      const match=/^\/v1\/jobs\/([a-zA-Z0-9-]+)(?:\/(cancel|audio))?$/.exec(url.pathname);
      if(match) {
        const id=match[1],action=match[2],job=jobs.get(id);if(!job)throw new HelperError('NOT_FOUND','Unknown job',404);
        if(req.method==='POST'&&action==='cancel') {
          if(!jobs.cancel(id))throw new HelperError('JOB_TERMINAL','This job has already finished',409);
          return json(res,200,{id,status:'cancelled'});
        }
        if(req.method==='DELETE'&&!action) {
          if(!jobs.delete(id))throw new HelperError('JOB_ACTIVE','Job cleanup has not finished',409);
          res.writeHead(204,{'cache-control':'no-store'});res.end();return;
        }
        if(req.method==='GET'&&action==='audio') {
          if(job.kind!=='audio-window'||job.status!=='completed')throw new HelperError('RESULT_UNAVAILABLE','No completed audio result',409);
          return binaryAudio(res,job.result as AudioSampleWindow);
        }
        if(req.method==='GET'&&!action) {
          if(job.kind==='audio-window'&&job.status==='completed') {
            const window=job.result as AudioSampleWindow;
            job.result={sampleRate:window.sampleRate,startSample:String(window.startSample),sampleCount:window.samples.length,format:'f32le',audioUrl:`/v1/jobs/${id}/audio`};
          }
          return json(res,200,job);
        }
      }
      throw new HelperError('NOT_FOUND','Route not found',404);
    }catch(error){const safe=publicError(error);json(res,safe.status,{error:{code:safe.code,message:safe.message}});}
    finally{controllers.delete(controller);}
  };
  const server=options.tls?createSecureServer({...options.tls,minVersion:'TLSv1.2',handshakeTimeout:5000},handle):createServer(handle);
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host,()=>{server.off('error',reject);resolve()})});
  const address=server.address();if(!address||typeof address==='string')throw new HelperError('START_FAILED','Unexpected helper address');
  let stopped:Promise<void>|undefined;
  return {address:`${options.tls?'https':'http'}://127.0.0.1:${address.port}`,sessionToken,close:()=>stopped??=(async()=>{
    closing=true;for(const controller of controllers)controller.abort();
    const closed=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await jobs.close();await Promise.allSettled([...operations]);await closed;
  })()};
}
