import {createServer,type IncomingMessage,type ServerResponse} from "node:http";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {readFile} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";
import {probeMedia,HelperError} from "./ffmpeg.js";import {decodeAudioWindow} from "./audio-window.js";

export interface HelperServerOptions {maxBodyBytes?:number;ffmpegPath?:string;ffprobePath?:string;cacheDir?:string}
export interface HelperServer {host:"127.0.0.1";port:number;token:string;close():Promise<void>}
function send(res:ServerResponse,status:number,body:unknown){const data=JSON.stringify(body);res.writeHead(status,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(data)});res.end(data);}
function authorized(req:IncomingMessage,token:string){const value=req.headers.authorization;if(!value?.startsWith("Bearer "))return false;const supplied=Buffer.from(value.slice(7)),expected=Buffer.from(token);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
async function readBody(req:IncomingMessage,max:number){const chunks:Buffer[]=[];let size=0,tooLarge=false;for await(const raw of req){const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);size+=chunk.length;if(size>max){tooLarge=true;continue;}chunks.push(chunk);}return{tooLarge,body:tooLarge?"":Buffer.concat(chunks).toString("utf8")};}
export async function createHelperServer(options:HelperServerOptions={}):Promise<HelperServer>{
 const host="127.0.0.1" as const,token=randomBytes(32).toString("base64url"),maxBodyBytes=options.maxBodyBytes??64*1024,cacheDir=options.cacheDir??join(tmpdir(),"pea-native-helper");
 if(!Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<1)throw new Error("maxBodyBytes must be a positive integer");
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url??"/","http://127.0.0.1");
  if(req.method==="GET"&&url.pathname==="/health"){send(res,200,{ok:true,protocol:"v1"});return;}
  if(!url.pathname.startsWith("/v1/")){send(res,404,{error:"NOT_FOUND"});return;}
  if(!authorized(req,token)){send(res,401,{error:"UNAUTHORIZED"});return;}
  const payload=await readBody(req,maxBodyBytes);if(payload.tooLarge){send(res,413,{error:"BODY_TOO_LARGE"});return;}
  let input:any;try{input=JSON.parse(payload.body||"{}");}catch{send(res,400,{error:"INVALID_JSON"});return;}
  if(req.method==="POST"&&url.pathname==="/v1/media/probe"){if(typeof input.path!=="string"||!input.path){send(res,400,{error:"PATH_REQUIRED"});return;}try{send(res,200,{probe:await probeMedia(input.path,{ffprobePath:options.ffprobePath})});}catch(error){if(error instanceof HelperError){send(res,422,{error:error.code,message:error.message});return;}throw error;}return;}
  if(req.method==="POST"&&url.pathname==="/v1/audio/window"){
   if(typeof input.path!=="string"||!input.path){send(res,400,{error:"PATH_REQUIRED"});return;}
   try{const a=await decodeAudioWindow(input.path,{ffmpegPath:options.ffmpegPath,ffprobePath:options.ffprobePath,cacheDir,startSeconds:Number(input.startSeconds),durationSeconds:Number(input.durationSeconds),sampleRate:Number(input.sampleRate),maxSamples:262144});const bytes=await readFile(a.path);res.writeHead(200,{"content-type":"application/octet-stream","content-length":bytes.length,"x-pea-sample-rate":String(a.sampleRate),"x-pea-start-sample":String(a.startSample),"x-pea-sample-count":String(a.sampleCount),"x-pea-sha256":a.sha256});res.end(bytes);}catch(error){if(error instanceof HelperError){send(res,422,{error:error.code,message:error.message});return;}throw error;}return;
  }
  send(res,501,{error:"NOT_IMPLEMENTED"});
 }catch(error){send(res,500,{error:"INTERNAL_ERROR",message:error instanceof Error?error.message:"unknown error"});}});
 await new Promise<void>((resolve,reject)=>{const onError=(e:Error)=>{server.off("listening",onListening);reject(e)},onListening=()=>{server.off("error",onError);resolve()};server.once("error",onError);server.once("listening",onListening);server.listen(0,host);});
 const address=server.address();if(!address||typeof address==="string")throw new Error("helper failed to bind TCP socket");
 return{host,port:address.port,token,close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
