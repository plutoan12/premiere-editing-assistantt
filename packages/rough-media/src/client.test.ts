import { test } from "vitest";
import assert from'node:assert/strict';import{createHybridMediaProvider,createHelperMediaProvider}from'./client.js';
const media={protocol:'pea-rough-media/1',path:'/source.mov',fileIdentity:'f',providerId:'avfoundation-v1',frameRate:{numerator:24,denominator:1},durationFrames:'120',width:160,height:90,channels:2,sampleRate:48000,sourceSampleRate:48000,cfr:true}as const;
test('helper client refuses insecure or remote bootstrap rather than silently falling back',()=>{
 for(const endpoint of ['http://127.0.0.1:1234','https://evil.example:1234','https://user:pass@127.0.0.1:1234'])assert.throws(()=>createHelperMediaProvider({endpoint,token:'t'.repeat(40)}));
});
test('Hybrid job polling checks metadata and decodes the bounded PCM wire',async()=>{
 let request:any;const p=createHybridMediaProvider({request:(input:string)=>{const x=JSON.parse(input);if(x.op==='poll')return JSON.stringify({status:'completed',result:request.op==='probe'?media:{meta:{startSample:0,sampleCount:2,channels:2,sampleRate:48000,fileIdentity:'f'},pcmBase64:Buffer.alloc(16).toString('base64')}});if(x.op==='delete')return'{}';request=x;return'{"jobId":"1"}';}});
 assert.equal((await p.probe('/source.mov')).fileIdentity,'f');const w=await p.readWindow({media,startSample:0,sampleCount:2});assert.equal(w.data.byteLength,16);
});
test('Hybrid cancellation reaches the native worker and cleans up its job',async()=>{
 const ops:string[]=[];const c=new AbortController();const p=createHybridMediaProvider({request:(input:string)=>{const x=JSON.parse(input);ops.push(x.op);if(x.op==='poll'){c.abort();return'{"status":"running"}';}return'{"jobId":"1"}';}});
 await assert.rejects(()=>p.probe('/source.mov',c.signal),{name:'AbortError'});assert(ops.includes('cancel'));assert(ops.includes('delete'));
});
test('helper cancellation remains attached while the response body is being read',async()=>{
 const c=new AbortController();let bodyStarted:()=>void=()=>{};const started=new Promise<void>(r=>bodyStarted=r);
 const p=createHelperMediaProvider({endpoint:'https://127.0.0.1:1234',token:'t'.repeat(40)},{fetch:async(_url:any,init:any)=>({ok:true,json:()=>new Promise((_resolve,reject)=>{bodyStarted();init.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});})})as any});
 const pending=p.probe('/source.mov',c.signal);await started;c.abort();await Promise.race([assert.rejects(()=>pending,{name:'AbortError'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('body was not cancelled')),80))]);
});
