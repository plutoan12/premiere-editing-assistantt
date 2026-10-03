import { test } from "vitest";
import assert from 'node:assert/strict';import {createServer}from'node:http';import type{AddressInfo}from'node:net';
import {createAudioRoutes}from'./audio-routes.js';
const media={protocol:'pea-rough-media/1',path:'/source.mov',fileIdentity:'f',providerId:'fake-test-only',frameRate:{numerator:24,denominator:1},durationFrames:'120',width:160,height:90,channels:2,sampleRate:48000,sourceSampleRate:48000,cfr:true} as const;
async function server(provider:any){const routes=createAudioRoutes(provider,{maxBodyBytes:1024});const s=createServer(async(req,res)=>{if(req.headers.authorization!=='Bearer test'){res.writeHead(401);res.end();return;}try{if(!await routes.handle(req,res)){res.writeHead(404);res.end();}}catch{res.writeHead(500);res.end();}});await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));return{url:`http://127.0.0.1:${(s.address()as AddressInfo).port}`,close:async()=>{await routes.stop();await new Promise<void>(r=>s.close(()=>r()));}};}
const init=(body:unknown)=>({method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify(body)});
async function done(url:string,id:string){for(let i=0;i<100;i++){const j=await(await fetch(url+'/v1/audio/jobs/'+id,{headers:{authorization:'Bearer test'}})).json() as any;if(['completed','failed','cancelled'].includes(j.status))return j;await new Promise(r=>setTimeout(r,5));}throw Error('job did not finish');}
test('authenticated probe/window jobs serve bounded binary PCM, never JSON number arrays',async()=>{
 const s=await server({probe:async()=>media,readWindow:async(r:any)=>({meta:{startSample:r.startSample,sampleCount:r.sampleCount,channels:2,sampleRate:48000,fileIdentity:'f'},data:new ArrayBuffer(r.sampleCount*8)})});try{
 assert.equal((await fetch(s.url+'/v1/media/probe',init({path:'/source.mov'}))).status,202);
 const p=await(await fetch(s.url+'/v1/media/probe',init({path:'/source.mov'}))).json()as any;await done(s.url,p.jobId);
 const a=await(await fetch(s.url+'/v1/audio/window',init({media,startSample:0,sampleCount:48}))).json()as any;assert.equal((await done(s.url,a.jobId)).status,'completed');
 const raw=await fetch(s.url+'/v1/audio/jobs/'+a.jobId+'/pcm',{headers:{authorization:'Bearer test'}});assert.equal((await raw.arrayBuffer()).byteLength,384);assert.equal(raw.headers.get('content-type'),'application/octet-stream');assert.equal((await fetch(s.url+'/v1/audio/jobs/'+a.jobId)).status,401);
 assert.equal((await fetch(s.url+'/v1/audio/jobs/'+a.jobId,{method:'DELETE',headers:{authorization:'Bearer test'}})).status,200);
 assert.equal((await fetch(s.url+'/v1/audio/jobs/'+a.jobId,{headers:{authorization:'Bearer test'}})).status,404);
 }finally{await s.close();}
});
test('body limit, unprobed descriptor and cancellation propagate without promoting results',async()=>{
 let wasAborted=false;const s=await server({probe:async(_p:string,signal:AbortSignal)=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>{wasAborted=true;reject(Object.assign(Error('cancel'),{name:'AbortError'}));},{once:true})),readWindow:async()=>{throw Error('should not run');}});try{
 assert.equal((await fetch(s.url+'/v1/media/probe',init({path:'x'.repeat(2000)}))).status,413);
 assert.equal((await fetch(s.url+'/v1/audio/window',init({media,startSample:0,sampleCount:1}))).status,409);
 const p=await(await fetch(s.url+'/v1/media/probe',init({path:'/source.mov'}))).json()as any;await fetch(s.url+'/v1/audio/jobs/'+p.jobId+'/cancel',init({}));assert.equal((await done(s.url,p.jobId)).status,'cancelled');assert(wasAborted);
 }finally{await s.close();}
});
