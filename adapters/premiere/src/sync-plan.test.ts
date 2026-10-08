import {describe,expect,it} from "vitest";
import type {SyncGroup} from "@pea/sync";
import {buildSyncDryRun} from "./sync-plan.js";

const group:SyncGroup={schemaVersion:"1.0.0",id:"g",referenceClipId:"a",strategy:"audio",status:"partial",confidence:.9,
 members:[
  {clipId:"a",mediaAssetId:"ma",offset:{ticks:0n,timebase:{numerator:1,denominator:48000}},offsetTicks:0n},
  {clipId:"b",mediaAssetId:"mb",offset:{ticks:-24000n,timebase:{numerator:1,denominator:48000}},offsetTicks:-24000n}
 ],candidates:[{referenceClipId:"a",clipId:"b",strategy:"audio",status:"matched",offset:{ticks:-24000n,timebase:{numerator:1,denominator:48000}},confidence:{score:.9,calibrated:false},reason:"AUDIO_MATCH",provenance:{provider:"test",version:"1"},evidence:[]},
 {referenceClipId:"a",clipId:"c",strategy:"audio",status:"review",confidence:{score:.2,calibrated:false},reason:"AMBIGUOUS_PEAK",provenance:{provider:"test",version:"1"},evidence:[]} ]};

const snapshot={projectId:"p1",projectVersion:"v1",sequenceNames:[],media:[
 {clipId:"a",mediaAssetId:"ma",projectItemId:"ia"},
 {clipId:"b",mediaAssetId:"mb",projectItemId:"ib"},
 {clipId:"c",mediaAssetId:"mc",projectItemId:"ic"}
]};

describe("Premiere sync dry run",()=>{
 it("rebases negative offsets without changing relative sync",()=>{
  const r=buildSyncDryRun(group,snapshot,{sequenceName:"PEA Sync",frameRate:{numerator:24,denominator:1}});
  expect(r.errors).toEqual([]); expect(r.operations.map(x=>x.startSeconds)).toEqual([.5,0]);
 });
 it("never generates placement for review-only candidates",()=>{
  const r=buildSyncDryRun(group,snapshot,{sequenceName:"PEA Sync",frameRate:{numerator:24,denominator:1}});
  expect(r.operations.some(x=>x.clipId==="c")).toBe(false);
 });
 it("rejects missing stable media mapping and sequence collision",()=>{
  expect(buildSyncDryRun(group,{...snapshot,media:snapshot.media.filter(x=>x.clipId!=="b")},{sequenceName:"PEA Sync",frameRate:{numerator:24,denominator:1}}).errors[0]).toMatch(/mapping/i);
  expect(buildSyncDryRun(group,{...snapshot,sequenceNames:["PEA Sync"]},{sequenceName:"PEA Sync",frameRate:{numerator:24,denominator:1}}).errors[0]).toMatch(/exists/i);
 });
 it("quantizes to the sequence frame grid and reports error",()=>{
  const shifted:SyncGroup={...group,members:[group.members[0],{...group.members[1],offset:{ticks:-23900n,timebase:{numerator:1,denominator:48000}},offsetTicks:-23900n}]};
  const r=buildSyncDryRun(shifted,snapshot,{sequenceName:"PEA Sync",frameRate:{numerator:24,denominator:1}});
  expect(r.operations.every(x=>Number.isInteger(x.startSeconds*24))).toBe(true);
  expect(r.warnings.some(x=>x.includes("quantized"))).toBe(true);
 });
});


describe("mixed timebase and identity safety",()=>{
 it("normalizes 25fps and 60fps offsets exactly on a 24fps sequence",()=>{
  const mixed:SyncGroup={...group,members:[
   {...group.members[0],offset:{ticks:100n,timebase:{numerator:1,denominator:25}},offsetTicks:100n},
   {...group.members[1],offset:{ticks:120n,timebase:{numerator:1,denominator:60}},offsetTicks:120n}
  ]};
  const r=buildSyncDryRun(mixed,snapshot,{sequenceName:"Mixed",frameRate:{numerator:24,denominator:1}});
  expect(r.errors).toEqual([]);
  expect(r.operations.map(x=>x.startSeconds)).toEqual([2,0]);
 });
 it("rejects duplicate clip identities",()=>{
  const duplicate:SyncGroup={...group,members:[group.members[0],group.members[0]]};
  const r=buildSyncDryRun(duplicate,snapshot,{sequenceName:"Duplicate",frameRate:{numerator:24,denominator:1}});
  expect(r.errors.some(x=>x.includes("duplicate clipId"))).toBe(true);
  expect(r.operations).toEqual([]);
 });
 it("rejects mismatched offset alias",()=>{
  const bad:SyncGroup={...group,members:[{...group.members[0],offsetTicks:1n},group.members[1]]};
  expect(buildSyncDryRun(bad,snapshot,{sequenceName:"Bad",frameRate:{numerator:24,denominator:1}}).errors.some(x=>x.includes("alias mismatch"))).toBe(true);
 });
});
