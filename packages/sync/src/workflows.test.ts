import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as sync from './index.js';
const time=(ticks:bigint)=>({ticks,timebase:{numerator:1,denominator:24}});
const range=(start:bigint,duration:bigint)=>({start:time(start),duration:time(duration)});
const rate={rate:{numerator:24,denominator:1},dropFrame:false};
const clip=(clipId:string,start=0n,duration=240n)=>({clipId,sourceId:`camera-${clipId}`,clockId:'jam',frameRate:rate,timecodeTicks:start,duration:time(duration)});
for(const n of [2,3,8]) test(`groups ${n} cameras with source identities intact`,()=>{
  const result=sync.buildMulticamGroups('shoot',Array.from({length:n},(_,i)=>clip(String(i),BigInt(i*10))));
  assert.equal(result.groups.length,1);assert.equal(result.groups[0].members.length,n);
  assert.equal(result.groups[0].members[1].sourceId,'camera-1');assert.deepEqual(result.unmatchedClipIds,[]);
});
test('separates disconnected sessions and includes an external recorder',()=>{
  const result=sync.buildMulticamGroups('shoot',[clip('a'),{...clip('recorder',5n),sourceId:'external-recorder'},clip('b',1000n),clip('c',1100n),clip('lonely',5000n)]);
  assert.equal(result.groups.length,2);assert.deepEqual(result.unmatchedClipIds,['lonely']);
  assert.equal(result.groups[0].members[1].sourceId,'external-recorder');
});
test('touching clips do not count as temporal overlap and different clocks stay separate',()=>{
  assert.equal(sync.buildMulticamGroups('s',[clip('a',0n,24n),clip('b',24n,24n)]).groups.length,0);
  assert.equal(sync.buildMulticamGroups('s',[clip('a'),{...clip('b'),clockId:'other'}]).groups.length,0);
});
test('multicam rejects duplicate IDs, zero duration and invalid timebases',()=>{
  assert.throws(()=>sync.buildMulticamGroups('s',[clip('a'),clip('a')]),/duplicate/i);
  assert.throws(()=>sync.buildMulticamGroups('s',[clip('a',0n,0n),clip('b')]),/duration/i);
  assert.throws(()=>sync.buildMulticamGroups('s',[{...clip('a'),duration:{ticks:1n,timebase:{numerator:0,denominator:1}}},clip('b')]),/timebase/i);
});
test('music takes align independently to a master, including slate/head silence',async()=>{
  let state=12;const master=Float32Array.from({length:512},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296-.5;});
  const take=master.slice(40,400),head=new Float32Array(320);head.set(master.slice(100,400),20);
  const windows:Record<string,Float32Array>={master,take,head};
  const result=await sync.syncPlayback('music',{clipId:'master',hasAudio:true},[{clipId:'take',hasAudio:true},{clipId:'head',hasAudio:true}],
    {audioProvider:{id:'fixtures',version:'1',async read(c){return {samples:windows[c.clipId],sampleRate:8000,startSample:0n};}}});
  assert.equal(result.referenceClipId,'master');assert.equal(result.members[1].offset.ticks,40n);assert.equal(result.members[2].offset.ticks,80n);
});
const artifact={id:'caption-1',clipId:'source-a',sourceRange:range(24n,24n)};
const decision=(id:string,sourceStart:bigint,duration:bigint,destination:bigint)=>({id,clipId:'source-a',sourceRange:range(sourceStart,duration),destination:time(destination)});
const sequence=(decisions:ReturnType<typeof decision>[])=>({id:'v2',name:'Revised',decisions});
test('re-sync follows ripple edits and head trims by stable source identity',()=>{
  const result=sync.resyncArtifacts([artifact],sequence([decision('cut',12n,120n,240n)]));
  assert.equal(result.mapped.length,1);assert.equal(result.mapped[0].range.start.ticks,252n);
  assert.equal(result.mapped[0].range.duration.ticks,24n);
});
test('reordered clips use revised placement, not previous timeline position',()=>{
  const result=sync.resyncArtifacts([artifact],sequence([decision('late',0n,120n,1000n)]));
  assert.equal(result.mapped[0].range.start.ticks,1024n);
});
test('deleted or partially trimmed artifacts are returned as unmapped, never truncated silently',()=>{
  assert.equal(sync.resyncArtifacts([artifact],sequence([])).unmapped[0].reason,'SOURCE_REMOVED');
  const result=sync.resyncArtifacts([artifact],sequence([decision('trim',36n,120n,0n)]));
  assert.equal(result.unmapped[0].reason,'SOURCE_TRIMMED');assert.equal(result.mapped.length,0);
});
test('duplicated source ranges report all possible mappings as conflicts',()=>{
  const result=sync.resyncArtifacts([artifact],sequence([decision('one',0n,120n,0n),decision('two',0n,120n,240n)]));
  assert.equal(result.mapped.length,0);assert.equal(result.conflicted.length,1);
  assert.deepEqual(result.conflicted[0].placements.map(p=>p.range.start.ticks),[24n,264n]);
});
test('re-sync rejects invalid ranges and duplicate IDs without mutating artifacts',()=>{
  const before=structuredClone(artifact);
  assert.throws(()=>sync.resyncArtifacts([artifact,artifact],sequence([])),/duplicate/i);
  assert.throws(()=>sync.resyncArtifacts([{...artifact,sourceRange:range(0n,-1n)}],sequence([])),/duration/i);
  sync.resyncArtifacts([artifact],sequence([decision('cut',0n,120n,240n)]));assert.deepEqual(artifact,before);
});
