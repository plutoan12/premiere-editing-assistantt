import { test } from "vitest";
import assert from 'node:assert/strict';
import {analyzeMedia}from'./index.js';
const media={protocol:'pea-rough-media/1',path:'/source.mov',fileIdentity:'f',providerId:'fixture',frameRate:{numerator:24,denominator:1},durationFrames:'240',width:160,height:90,channels:2,sampleRate:48000,sourceSampleRate:48000,cfr:true}as const;
function provider(){return{probe:async()=>media,readWindow:async({startSample,sampleCount}:any)=>{const data=new ArrayBuffer(sampleCount*8),v=new DataView(data);for(let i=0;i<sampleCount;i++){const sec=(startSample+i)/48000;const x=sec>=4.8&&sec<5.6?0:.2;v.setFloat32(i*8,x,true);v.setFloat32(i*8+4,-x,true);}return{data,meta:{startSample,sampleCount,channels:2,sampleRate:48000,fileIdentity:'f'}};}};}
test('bounded windows retain one continuous silence candidate across the 5-second seam',async()=>{
 const result=await analyzeMedia(provider(),'/source.mov','clip');assert.equal(result.candidates.length,1);const r=result.candidates[0].sourceRange;assert.equal(Number(r.start.ticks)*r.start.timebase.numerator/r.start.timebase.denominator,4.9);assert.equal(Number(r.duration.ticks)*r.duration.timebase.numerator/r.duration.timebase.denominator,.6);
});
test('cancellation between windows stops work and never returns a partial proposal',async()=>{
 const c=new AbortController();let calls=0;const p=provider();const base=p.readWindow;p.readWindow=async(r:any)=>{calls++;return base(r);};
 await assert.rejects(()=>analyzeMedia(p,'/source.mov','clip',{signal:c.signal,onProgress:()=>c.abort()}),{name:'AbortError'});assert.equal(calls,1);
});
test('wrong source-clock metadata or changed file invalidates the analysis',async()=>{
 const p=provider();const base=p.readWindow;p.readWindow=async(r:any)=>{const w=await base(r);w.meta.startSample++;return w;};await assert.rejects(()=>analyzeMedia(p,'/source.mov','clip'),/metadata/);
 const q=provider();let n=0;q.probe=async()=>({...media,fileIdentity:++n===1?'f':'changed'})as any;await assert.rejects(()=>analyzeMedia(q,'/source.mov','clip'),/changed/);
});
