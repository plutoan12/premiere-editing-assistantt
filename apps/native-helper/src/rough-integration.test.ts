import { test } from "vitest";
import assert from 'node:assert/strict';
import {startHelperServer}from'./server.js';
import {createHelperMediaProvider}from'@pea/rough-media/client';
const media={protocol:'pea-rough-media/1',path:'/source.mov',fileIdentity:'f',providerId:'fixture',frameRate:{numerator:24,denominator:1},durationFrames:'120',width:160,height:90,channels:1,sampleRate:48000,sourceSampleRate:48000,cfr:true}as const;
test('existing helper authentication wraps rough endpoints; no whisper model is needed',async()=>{
 let calls=0;const helper=await startHelperServer({allowInsecureDev:true,mediaProvider:{probe:async()=>{calls++;return media;},readWindow:async r=>({meta:{startSample:r.startSample,sampleCount:r.sampleCount,channels:1,sampleRate:48000,fileIdentity:'f'},data:new ArrayBuffer(r.sampleCount*4)})}});
 try{const unauthorized=await fetch(helper.endpoint+'/v1/media/probe',{method:'POST',body:JSON.stringify({path:'/source.mov'})});assert.equal(unauthorized.status,401);assert.equal(calls,0);
 const client=createHelperMediaProvider(helper,{allowInsecureDev:true});const m=await client.probe('/source.mov');assert.equal(m.fileIdentity,'f');assert.equal((await client.readWindow({media:m,startSample:0,sampleCount:2})).data.byteLength,8);
 const disabled=await fetch(helper.endpoint+'/v1/transcriptions',{method:'POST',headers:{authorization:`Bearer ${helper.token}`},body:'{}'});assert.equal(disabled.status,503);
 }finally{await helper.stop();}
});
