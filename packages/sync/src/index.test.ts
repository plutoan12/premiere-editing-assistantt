import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as sync from "./index.js";
import { tc } from "./test-fixtures.js";

describe("timecode contracts and strategy", () => {
  it("prefers complete compatible timecode", () => {
    assert.equal(sync.chooseSyncStrategy([tc("a", 10n), tc("b", 20n)]), "timecode");
  });
  it("falls back to audio fingerprints when timecode is incomplete", () => {
    assert.equal(sync.chooseSyncStrategy([{clipId:"a",audioFingerprint:"x"},{clipId:"b",audioFingerprint:"y"}]),"audio");
  });
  it("requires manual review without deterministic evidence", () => {
    assert.equal(sync.chooseSyncStrategy([{clipId:"a"},{clipId:"b"}]),"manual");
  });
  it("does not guess the units of legacy bare ticks", () => {
    assert.equal(sync.chooseSyncStrategy([{clipId:"a",timecodeTicks:10n},{clipId:"b",timecodeTicks:20n}]),"manual");
    assert.throws(()=>sync.buildTimecodeSyncGroup("g",[{clipId:"a",timecodeTicks:10n},{clipId:"b",timecodeTicks:20n}]));
  });
  it("normalizes against earliest without losing bigint precision or mutating input", () => {
    const items=[tc("a",9007199254741000n),tc("b",9007199254740993n)];
    const before=structuredClone(items);
    const group=sync.buildTimecodeSyncGroup("g",items);
    assert.deepEqual(group.members.map(x=>x.offsetTicks),[7n,0n]);
    assert.deepEqual(group.members[0].offset,{ticks:7n,timebase:{numerator:1,denominator:24}});
    assert.equal(group.confidence,1);
    assert.equal(group.provenance.length,2);
    assert.deepEqual(items,before);
  });
  for (const [numerator,denominator,dropFrame] of [[24,1,false],[24000,1001,false],[30000,1001,false],[30000,1001,true]] as const) {
    it(`preserves ${numerator}/${denominator} DF=${dropFrame} exactly`,()=>{
      const frameRate={rate:{numerator,denominator},dropFrame};
      const timebase={numerator:denominator,denominator:numerator};
      const g=sync.buildTimecodeSyncGroup("g",[tc("a",100n,{frameRate,timebase}),tc("b",125n,{frameRate,timebase})]);
      assert.deepEqual(g.timebase,timebase);
      assert.equal(g.members[1].offset.ticks,25n);
    });
  }
  it("rejects duplicate and empty clip IDs",()=>{
    assert.throws(()=>sync.chooseSyncStrategy([tc("a",0n),tc("a",1n)]),/duplicate/i);
    assert.throws(()=>sync.buildTimecodeSyncGroup("g",[tc("",0n),tc("b",1n)]),/clip/i);
  });
  it("rejects empty and singleton groups",()=>{
    assert.throws(()=>sync.buildTimecodeSyncGroup("g",[]));
    assert.throws(()=>sync.buildTimecodeSyncGroup("g",[tc("a",0n)]));
    assert.throws(()=>sync.buildTimecodeSyncGroup("",[tc("a",0n),tc("b",1n)]));
  });
  it("never silently converts mismatched timebases or frame rates",()=>{
    const a=tc("a",0n);
    for(const b of [tc("b",1n,{timebase:{numerator:1,denominator:25}}),tc("b",1n,{frameRate:{rate:{numerator:25,denominator:1},dropFrame:false}})]) {
      assert.equal(sync.chooseSyncStrategy([a,b]),"manual");
      assert.throws(()=>sync.buildTimecodeSyncGroup("g",[a,b]));
    }
  });
  it("does not mix DF and NDF even at identical rates",()=>{
    const frameRate={rate:{numerator:30000,denominator:1001},dropFrame:false};
    assert.throws(()=>sync.buildTimecodeSyncGroup("g",[tc("a",0n,{frameRate}),tc("b",1n,{frameRate:{...frameRate,dropFrame:true}})]));
  });
  it("rejects invalid and unsupported rate metadata",()=>{
    for(const rate of [{numerator:26,denominator:1},{numerator:24,denominator:0},{numerator:Number.MAX_SAFE_INTEGER+1,denominator:1}]) {
      const items=[tc("a",0n,{frameRate:{rate,dropFrame:false}}),tc("b",1n,{frameRate:{rate,dropFrame:false}})];
      assert.throws(()=>sync.buildTimecodeSyncGroup("g",items));
    }
    assert.throws(()=>sync.buildTimecodeSyncGroup("g",[tc("a",-1n),tc("b",0n)]));
  });
  it("keeps declared timecode clock domains separate",()=>{
    assert.equal(sync.chooseSyncStrategy([tc("a",0n,{timecodeDomain:"day1"}),tc("b",1n,{timecodeDomain:"day2"})]),"manual");
  });
  it("accepts equivalent rational representations without changing units",()=>{
    const g=sync.buildTimecodeSyncGroup("g",[tc("a",0n),tc("b",1n,{timebase:{numerator:2,denominator:48}})]);
    assert.equal(g.members[1].offsetTicks,1n);
  });
});
