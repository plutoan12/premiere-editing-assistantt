import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as sync from "./index.js";
import { audio, noise, provider, tc } from "./test-fixtures.js";

describe("multicam grouping",()=>{
  for(const count of [2,3,8]) it(`groups ${count} overlapping cameras`,()=>{
    const clips=Array.from({length:count},(_,i)=>tc(`cam${i}`,BigInt(i),{durationTicks:100n,cameraId:`C${i}`,sourceId:`S${i}`,role:"camera"}));
    const r=sync.buildMulticamGroups("shoot",clips);
    assert.equal(r.groups.length,1);assert.equal(r.groups[0].members.length,count);
    assert.equal(r.groups[0].members[count-1].cameraId,`C${count-1}`);
  });
  it("separates disconnected time ranges and reports singleton clips",()=>{
    const r=sync.buildMulticamGroups("shoot",[tc("a",0n,{durationTicks:50n}),tc("b",10n,{durationTicks:50n}),tc("c",100n,{durationTicks:20n}),tc("d",105n,{durationTicks:30n}),tc("e",300n,{durationTicks:10n})]);
    assert.equal(r.groups.length,2);assert.deepEqual(r.unmatchedClipIds,["e"]);
  });
  it("does not treat touching half-open ranges as overlap",()=>{
    const r=sync.buildMulticamGroups("shoot",[tc("a",0n,{durationTicks:10n}),tc("b",10n,{durationTicks:10n})]);
    assert.equal(r.groups.length,0);assert.equal(r.unmatchedClipIds.length,2);
  });
  it("preserves external recorder identity",()=>{
    const r=sync.buildMulticamGroups("shoot",[tc("a",0n,{durationTicks:100n,role:"camera"}),tc("rec",5n,{durationTicks:200n,role:"recorder",sourceId:"audio-1"})]);
    assert.equal(r.groups[0].members[1].role,"recorder");assert.equal(r.groups[0].members[1].sourceId,"audio-1");
  });
  it("does not group clocks from different recording days",()=>{
    const r=sync.buildMulticamGroups("shoot",[tc("a",0n,{durationTicks:100n,timecodeDomain:"day1"}),tc("b",0n,{durationTicks:100n,timecodeDomain:"day2"})]);
    assert.equal(r.groups.length,0);
  });
  it("reports missing duration rather than inventing overlap",()=>{
    const r=sync.buildMulticamGroups("shoot",[tc("a",0n),tc("b",1n,{durationTicks:100n})]);
    assert.equal(r.groups.length,0);assert.ok(r.unmatchedClipIds.includes("a"));
  });
});

describe("music playback",()=>{
  it("aligns multiple independent takes to one decoded master",async()=>{
    const x=noise(700),p=provider({master:audio(x),t1:audio(x.slice(20,400)),t2:audio(x.slice(75,500))});
    const r=await sync.syncPlayback({id:"mv",reference:tc("master",0n),takes:[tc("t1",999n),tc("t2",12345n)],provider:p.value,correlation:{maxOffsetSamples:150,minOverlapSamples:64}});
    assert.equal(r.length,2);assert.ok(r.every(x=>x.result.status==="synced"));
    assert.equal(r[0].result.group?.members[1].offsetTicks,20n);assert.equal(r[1].result.group?.members[1].offsetTicks,75n);
    assert.equal(p.calls.filter(x=>x==="master").length,1);assert.equal(r[0].result.group?.strategy,"audio");
  });
  it("handles a slate/head silence before a truncated take",async()=>{
    const x=noise(600),take=new Float64Array(400);take.set(x.slice(25,385),40);const p=provider({master:audio(x),take:audio(take)});
    const r=await sync.syncPlayback({id:"mv",reference:{clipId:"master"},takes:[{clipId:"take"}],provider:p.value,correlation:{maxOffsetSamples:100,minOverlapSamples:100,minScore:0.8}});
    assert.equal(r[0].result.status,"synced");assert.equal(r[0].result.group?.members[0].offsetTicks,15n);
  });
  it("returns per-take failure without dropping successful takes",async()=>{
    const x=noise(512),p=provider({master:audio(x),good:audio(x.slice(20,300))});
    const r=await sync.syncPlayback({id:"mv",reference:{clipId:"master"},takes:[{clipId:"bad"},{clipId:"good"}],provider:p.value,correlation:{maxOffsetSamples:100,minOverlapSamples:64}});
    assert.equal(r[0].result.status,"review-required");assert.equal(r[1].result.status,"synced");
  });
});

const time=(ticks:bigint)=>({ticks,timebase:{numerator:1,denominator:24}});
const range=(start:bigint,duration:bigint)=>({start:time(start),duration:time(duration)});
const artifact={id:"caption",clipId:"source",sourceRange:range(10n,5n)};
const segment=(id:string,start:bigint,sourceStart=0n,duration=100n):sync.ResyncSegment=>({id,clipId:"source",sourceRange:range(sourceStart,duration),sequenceStart:time(start)});
describe("source-anchored re-sync",()=>{
  it("maps ripple edits with exact source identity",()=>{
    const r=sync.resyncArtifacts([artifact],[segment("new",50n)]);
    assert.equal(r.mapped[0].sequenceRange.start.ticks,60n);assert.equal(r.mapped[0].sequenceRange.duration.ticks,5n);
  });
  it("accounts for a trimmed head",()=>{
    const r=sync.resyncArtifacts([artifact],[segment("new",100n,8n,50n)]);
    assert.equal(r.mapped[0].sequenceRange.start.ticks,102n);
  });
  it("reports partially trimmed artifacts instead of silently cropping",()=>{
    const r=sync.resyncArtifacts([artifact],[segment("new",100n,12n,50n)]);
    assert.equal(r.mapped.length,0);assert.equal(r.unmapped[0].reason,"source-range-not-covered");
  });
  it("maps reordered clips by source, not old timeline position",()=>{
    const r=sync.resyncArtifacts([artifact],[{...segment("other",0n),clipId:"other"},segment("new",200n)]);
    assert.equal(r.mapped[0].sequenceRange.start.ticks,210n);
  });
  it("reports deleted clips",()=>{
    const r=sync.resyncArtifacts([artifact],[]);assert.equal(r.unmapped[0].reason,"deleted-source");
  });
  it("returns conflicts for duplicated source segments",()=>{
    const r=sync.resyncArtifacts([artifact],[segment("copy1",0n),segment("copy2",200n)]);
    assert.equal(r.mapped.length,0);assert.equal(r.conflicted[0].candidates.length,2);
  });
  it("does not silently map speed changes as one-times playback",()=>{
    const r=sync.resyncArtifacts([artifact],[{...segment("fast",0n),playbackRate:{numerator:2,denominator:1}}]);
    assert.equal(r.mapped.length,0);assert.equal(r.unmapped[0].reason,"unsupported-playback-rate");
  });
  it("rejects incompatible timebases",()=>{
    const s=segment("new",0n);s.sequenceStart.timebase={numerator:1,denominator:25};
    assert.throws(()=>sync.resyncArtifacts([artifact],[s]),/timebase/i);
  });
  it("rejects invalid ranges and duplicate artifact IDs",()=>{
    assert.throws(()=>sync.resyncArtifacts([{...artifact,sourceRange:range(0n,-1n)}],[]));
    assert.throws(()=>sync.resyncArtifacts([artifact,artifact],[segment("new",0n)]),/duplicate/i);
  });
  it("does not mutate artifacts or sequence descriptions",()=>{
    const artifacts=[structuredClone(artifact)],segments=[segment("new",50n)];const before=structuredClone({artifacts,segments});
    sync.resyncArtifacts(artifacts,segments);assert.deepEqual({artifacts,segments},before);
  });
});
