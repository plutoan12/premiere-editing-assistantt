import { test } from "vitest";
import assert from 'node:assert/strict';
import { renderRoughXml, createApplyGate } from './index.js';
const t=(ticks:bigint)=>({ticks,timebase:{numerator:1,denominator:24}});
const media={protocol:'pea-rough-media/1',path:'/Users/Test/촬영 A&B.mov',fileIdentity:'f',providerId:'fixture',frameRate:{numerator:24,denominator:1},durationFrames:'120',width:160,height:90,channels:2,sampleRate:48000,sourceSampleRate:48000,cfr:true} as const;
const plan={id:'rough-1',name:'PEA Rough <test>',decisions:[{id:'d1',clipId:'clip',sourceRange:{start:t(0n),duration:t(24n)},destination:t(0n)},{id:'d2',clipId:'clip',sourceRange:{start:t(48n),duration:t(24n)},destination:t(24n)}]};
const snapshot={projectId:'p1',projectPath:'/p.prproj',clipId:'clip',sourcePath:media.path,interpretation:'24:1',sequenceState:'s1:0'};
test('XML keeps source timing, channel indices, linking and escapes user text',()=>{
 const xml=renderRoughXml(plan,media,'clip');assert(xml.includes('<in>48</in><out>72</out>'));assert(xml.includes('PEA Rough &lt;test&gt;'));assert(xml.includes('%EC%B4%AC'));assert.equal((xml.match(/<clipitem /g)||[]).length,6);assert.equal((xml.match(/<file id="pea-source">/g)||[]).length,1);assert(xml.includes('<outputchannelindex>2</outputchannelindex>'));assert(xml.includes('<updatebehavior>add</updatebehavior>'));
});
test('invalid clip, gaps, unsupported rates and fractional frames never produce XML',()=>{
 for(const mutate of [(p:any)=>p.decisions[0].clipId='other',(p:any)=>p.decisions[1].destination=t(25n),(p:any)=>p.decisions[1].sourceRange.start={ticks:1n,timebase:{numerator:1,denominator:1000}},(p:any)=>p.decisions[1].sourceRange.duration=t(120n)]){
 const p=structuredClone(plan);mutate(p);assert.throws(()=>renderRoughXml(p,media,'clip'));
 }
 assert.throws(()=>renderRoughXml(plan,{...media,frameRate:{numerator:2398,denominator:100}},'clip'),/rate/);
});
test('apply requires a current preview and the exact approved preview id',async()=>{
 let current={...snapshot},imports=0;const gate=createApplyGate({snapshot:async()=>current,writeXml:async()=>'/tmp/test.xml',importXml:async()=>{imports++;return true;}});
 const p=await gate.preview(plan,media,'clip');await assert.rejects(()=>gate.apply('wrong'),/approval/);
 current={...current,sequenceState:'changed'};await assert.rejects(()=>gate.apply(p.id),/stale/);assert.equal(imports,0);
});
test('double click and failure after import starts cannot automatically retry',async()=>{
 let calls=0;let release:(x:boolean)=>void=()=>{};
 const gate=createApplyGate({snapshot:async()=>snapshot,writeXml:async()=>'/tmp/test.xml',importXml:()=>{calls++;return new Promise<boolean>(r=>release=r);}});
 const p=await gate.preview(plan,media,'clip');const first=gate.apply(p.id);await new Promise(r=>setTimeout(r,0));await assert.rejects(()=>gate.apply(p.id),/consumed|busy/);release(false);await assert.rejects(()=>first,/inspect/);await assert.rejects(()=>gate.apply(p.id),/consumed|approval/);assert.equal(calls,1);
});
test('preview owns an immutable plan snapshot; project change during write is rejected',async()=>{
 let xmlWritten='';const local=structuredClone(plan);const gate=createApplyGate({snapshot:async()=>snapshot,writeXml:async(xml:string)=>{xmlWritten=xml;return'/tmp/a.xml';},importXml:async()=>true});
 const p=await gate.preview(local,media,'clip');local.decisions[0].sourceRange.duration=t(100n);await gate.apply(p.id);assert(!xmlWritten.includes('<out>100</out>'));
 let current={...snapshot},imports=0;const changed=createApplyGate({snapshot:async()=>current,writeXml:async()=>{current={...current,projectId:'p2'};return'/tmp/a.xml';},importXml:async()=>{imports++;return true;}});
 const q=await changed.preview(plan,media,'clip');await assert.rejects(()=>changed.apply(q.id),/stale/);assert.equal(imports,0);
});
