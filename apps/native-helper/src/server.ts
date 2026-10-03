import {createServer,type IncomingMessage,type ServerResponse} from "node:http";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {probeMedia,HelperError} from "./ffmpeg.js";

export interface HelperServerOptions { maxBodyBytes?: number }
export interface HelperServer { host:"127.0.0.1"; port:number; token:string; close():Promise<void> }

function send(res:ServerResponse,status:number,body:unknown):void {
  const data=JSON.stringify(body);
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(data)});
  res.end(data);
}
function authorized(req:IncomingMessage,token:string):boolean {
  const value=req.headers.authorization;
  if(!value?.startsWith("Bearer ")) return false;
  const supplied=Buffer.from(value.slice(7));
  const expected=Buffer.from(token);
  return supplied.length===expected.length && timingSafeEqual(supplied,expected);
}
async function readBody(req:IncomingMessage,max:number):Promise<{tooLarge:boolean;body:string}> {
  const chunks:Buffer[]=[]; let size=0; let tooLarge=false;
  for await (const raw of req) {
    const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
    size+=chunk.length;
    if(size>max){tooLarge=true;continue;}
    chunks.push(chunk);
  }
  return {tooLarge,body:tooLarge?"":Buffer.concat(chunks).toString("utf8")};
}
export async function createHelperServer(options:HelperServerOptions={}):Promise<HelperServer> {
  const host="127.0.0.1" as const, token=randomBytes(32).toString("base64url"), maxBodyBytes=options.maxBodyBytes??64*1024;
  if(!Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<1) throw new Error("maxBodyBytes must be a positive integer");
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url??"/","http://127.0.0.1");
      if(req.method==="GET"&&url.pathname==="/health"){send(res,200,{ok:true,protocol:"v1"});return;}
      if(!url.pathname.startsWith("/v1/")){send(res,404,{error:"NOT_FOUND"});return;}
      if(!authorized(req,token)){send(res,401,{error:"UNAUTHORIZED"});return;}
      const payload=await readBody(req,maxBodyBytes);
      if(payload.tooLarge){send(res,413,{error:"BODY_TOO_LARGE"});return;}
      if(req.method==="POST"&&url.pathname==="/v1/media/probe"){
        let input:any;try{input=JSON.parse(payload.body||"{}");}catch{send(res,400,{error:"INVALID_JSON"});return;}
        if(typeof input.path!=="string"||!input.path){send(res,400,{error:"PATH_REQUIRED"});return;}
        try{send(res,200,{probe:await probeMedia(input.path,{ffprobePath:process.env.PEA_FFPROBE_PATH})});}catch(error){if(error instanceof HelperError){send(res,422,{error:error.code,message:error.message});return;}throw error;}
        return;
      }
      send(res,501,{error:"NOT_IMPLEMENTED"});
    } catch(error) {
      send(res,500,{error:"INTERNAL_ERROR",message:error instanceof Error?error.message:"unknown error"});
    }
  });
  await new Promise<void>((resolve,reject)=>{
    const onError=(error:Error)=>{server.off("listening",onListening);reject(error);};
    const onListening=()=>{server.off("error",onError);resolve();};
    server.once("error",onError);server.once("listening",onListening);server.listen(0,host);
  });
  const address=server.address();
  if(!address||typeof address==="string") throw new Error("helper failed to bind TCP socket");
  return {host,port:address.port,token,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
