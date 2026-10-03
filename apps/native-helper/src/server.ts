import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {HELPER_PROTOCOL_VERSION} from './protocol.js';

export interface HelperServer {address:string;sessionToken:string;close():Promise<void>}
function authorized(req:IncomingMessage,token:string):boolean {
 const raw=req.headers.authorization; if(!raw?.startsWith('Bearer ')) return false;
 const value=raw.slice(7); const a=Buffer.from(value),b=Buffer.from(token);
 return a.length===b.length && timingSafeEqual(a,b);
}
function json(res:ServerResponse,status:number,body:unknown){const data=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(data)});res.end(data)}
export async function createHelperServer(options:{host:string;port:number;sessionToken?:string}):Promise<HelperServer>{
 if(options.host!=='127.0.0.1') throw new Error('helper must bind to IPv4 loopback 127.0.0.1');
 const sessionToken=options.sessionToken??randomBytes(32).toString('hex');
 const server=createServer((req,res)=>{
   const url=new URL(req.url??'/','http://127.0.0.1');
   if(req.method==='GET'&&url.pathname==='/health') return json(res,200,{ok:true,protocolVersion:HELPER_PROTOCOL_VERSION});
   if(url.pathname.startsWith('/v1/')&&!authorized(req,sessionToken)) return json(res,401,{error:{code:'UNAUTHORIZED',message:'invalid session token'}});
   if(req.method==='GET'&&url.pathname==='/v1/ping') return json(res,200,{ok:true,protocolVersion:HELPER_PROTOCOL_VERSION});
   return json(res,404,{error:{code:'NOT_FOUND',message:'route not found'}});
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host,()=>{server.off('error',reject);resolve()})});
 const addr=server.address(); if(!addr||typeof addr==='string') throw new Error('unexpected helper address');
 return {address:`http://127.0.0.1:${addr.port}`,sessionToken,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
