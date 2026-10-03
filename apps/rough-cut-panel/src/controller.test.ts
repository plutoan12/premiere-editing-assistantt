import { test } from "vitest";
import assert from 'node:assert/strict';
import { createRoughController } from './controller.js';
const m={protocol:'pea-rough-media/1',path:'/source.mov',fileIdentity:'f',providerId:'fixture',frameRate:{numerator:24,denominator:1},durationFrames:'120',width:160,height:90,channels:1,sampleRate:48000,sourceSampleRate:48000,cfr:true}as const;
const snapshot={projectId:'p',projectPath:'/p.prproj',clipId:'c',sourcePath:'/source.mov',interpretation:JSON.stringify({fps:24,par:1,pulldown:false,field:0,defaultField:0,progressiveField:1,lut:''}),sequenceState:'[]'};
function fixture(){let imports=0,xml='';const provider={probe:async()=>m,readWindow:async(r:any)=>{const data=new ArrayBuffer(r.sampleCount*4),view=new DataView(data);for(let i=0;i<r.sampleCount;i++)view.setFloat32(i*4,(i/48000>=1&&i/48000<2)?0:.2,true);return{data,meta:{...r,media:undefined,channels:1,sampleRate:48000,fileIdentity:'f'}};}};const host={snapshot:async()=>snapshot,writeXml:async(x:string)=>{xml=x;return'/preview.xml';},importXml:async()=>{imports++;return true;}};return{provider,host,count:()=>imports,xml:()=>xml};}
test('controller keeps pending, requires preview and explicit exclusions; review invalidates old approval',async()=>{
 const f=fixture(),c=createRoughController(f.host);await assert.rejects(()=>c.apply(),/preview/);await c.analyze(f.provider);assert.equal(c.state().candidates[0].action,'pending');await c.preview();c.review(c.state().candidates[0].id,'exclude');await assert.rejects(()=>c.apply(),/preview/);await c.preview();await c.apply();assert.equal(f.count(),1);assert(f.xml().includes('<in>45</in>'));await assert.rejects(()=>c.apply());
});
test('controller refuses changed source or selection before applying; no import occurs',async()=>{
 const f=fixture(),c=createRoughController(f.host);await c.analyze(f.provider);await c.preview();f.provider.probe=async()=>({...m,fileIdentity:'changed'})as any;await assert.rejects(()=>c.apply(),/changed/);assert.equal(f.count(),0);
});
