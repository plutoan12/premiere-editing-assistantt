import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {HELPER_PROTOCOL_VERSION} from './protocol.js';
import {probeMedia,type MediaProbe} from './ffmpeg.js';

export interface HelperServer {address:string;sessionToken:string;close():Promise<void>}
type Options={host:string;port:number;sessionToken?:string;probe?:(path:string,signal?:AbortSignal)=>Promise<MediaProbe>}
function authorized(req:IncomingMessage,token:string):boolean {const raw=req.headers.authorization;if(!raw?.startsWith('Bearer '))return false;const a=Buffer.from(raw.slice(7)),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b)}
function json(res:ServerResponse,status:number,body:unknown){const data=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(data)});res.end(data)}
async function body(req:IncomingMessage,max=65536):Promise<any>{const chunks:Buffer[]=[];let n=0;for await(const chunk of req){const b=Buffer.from(chunk);n+=b.length;if(n>max)throw Object.assign(new Error('request body too large'),{status:413});chunks.push(b)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('invalid JSON'),{status:400})}}
export async function createHelperServer(options:Options):Promise<HelperServer>{
 if(options.host!=='127.0.0.1')throw new Error('helper must bind to IPv4 loopback 127.0.0.1');
 const sessionToken=options.sessionToken??randomBytes(32).toString('hex'),probe=options.probe??((path,signal)=>probeMedia(path,{signal}));
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url??'/','http://127.0.0.1');
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,protocolVersion:HELPER_PROTOCOL_VERSION});
  if(url.pathname.startsWith('/v1/')&&!authorized(req,sessionToken))return json(res,401,{error:{code:'UNAUTHORIZED',message:'invalid session token'}});
  if(req.method==='GET'&&url.pathname==='/v1/ping')return json(res,200,{ok:true,protocolVersion:HELPER_PROTOCOL_VERSION});
  if(req.method==='POST'&&url.pathname==='/v1/media/probe'){const input=await body(req);if(typeof input.path!=='string'||!input.path.trim())return json(res,400,{error:{code:'INVALID_PATH',message:'path required'}});return json(res,200,await probe(input.path))}
  return json(res,404,{error:{code:'NOT_FOUND',message:'route not found'}});
 }catch(e){const status=typeof (e as any)?.status==='number'?(e as any).status:500;return json(res,status,{error:{code:status===413?'BODY_TOO_LARGE':'HELPER_ERROR',message:e instanceof Error?e.message:'helper error'}})}});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host,()=>{server.off('error',reject);resolve()})});
 const addr=server.address();if(!addr||typeof addr==='string')throw new Error('unexpected helper address');
 return {address:`http://127.0.0.1:${addr.port}`,sessionToken,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
