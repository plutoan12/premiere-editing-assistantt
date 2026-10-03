import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as sync from "./index.js";
import { audio, noise, provider, tc } from "./test-fixtures.js";
const correlation={maxOffsetSamples:100,minOverlapSamples:64};

describe("sync orchestration",()=>{
  it("uses valid timecode without decoding audio",async()=>{
    const p=provider({});const r=await sync.synchronize({id:"g",items:[tc("a",0n),tc("b",10n)],provider:p.value});
    assert.equal(r.status,"synced");assert.equal(r.group?.strategy,"timecode");assert.deepEqual(p.calls,[]);
  });
  it("falls back to actual samples, not fingerprint equality",async()=>{
    const x=noise(512),p=provider({a:audio(x),b:audio(x.slice(40,340))});
    const r=await sync.synchronize({id:"g",items:[tc("a",0n),{clipId:"b"}],provider:p.value,correlation});
    assert.equal(r.status,"synced");assert.deepEqual(r.group?.members.map(x=>x.offsetTicks),[0n,40n]);
    assert.deepEqual(r.group?.timebase,{numerator:1,denominator:8000});
    assert.equal(r.group?.provenance[1].method,"audio-correlation");
  });
  it("uses audio rather than silently converting incompatible timecodes",async()=>{
    const x=noise(512),p=provider({a:audio(x),b:audio(x.slice(20,320))});
    const r=await sync.synchronize({id:"g",items:[tc("a",0n),tc("b",0n,{timebase:{numerator:1,denominator:25}})],provider:p.value,correlation});
    assert.equal(r.status,"synced");assert.equal(r.group?.strategy,"audio");
  });
  it("leaves no-evidence inputs for manual review",async()=>{
    const r=await sync.synchronize({id:"g",items:[{clipId:"a"},{clipId:"b"}]});
    assert.equal(r.status,"review-required");assert.equal(r.group,undefined);
  });
  it("does not auto-accept an ambiguous periodic match",async()=>{
    const x=Float64Array.from({length:512},(_,i)=>Math.sin(i*Math.PI/4)*0.5),p=provider({a:audio(x),b:audio(x)});
    const r=await sync.synchronize({id:"g",items:[{clipId:"a"},{clipId:"b"}],provider:p.value,correlation:{...correlation,peakExclusionSamples:1}});
    assert.equal(r.status,"review-required");assert.equal(r.group,undefined);assert.equal(r.candidates[0].reason,"ambiguous");
  });
  it("compensates both analysis-window start positions",async()=>{
    const x=noise(256),p=provider({a:audio(x,100),b:audio(x,80)});
    const r=await sync.synchronize({id:"g",items:[{clipId:"a"},{clipId:"b"}],provider:p.value,correlation});
    assert.equal(r.status,"synced");assert.deepEqual(r.group?.members.map(x=>x.offsetTicks),[0n,20n]);
  });
  it("normalizes a negative take offset against the earliest member",async()=>{
    const x=noise(256),y=new Float64Array(300);y.set(x,44);const p=provider({a:audio(x),b:audio(y)});
    const r=await sync.synchronize({id:"g",items:[{clipId:"a"},{clipId:"b"}],provider:p.value,correlation});
    assert.deepEqual(r.group?.members.map(x=>x.offsetTicks),[44n,0n]);
  });
  it("keeps valid candidates when another provider read fails",async()=>{
    const x=noise(512),p=provider({a:audio(x),b:audio(x.slice(20,320))});
    const r=await sync.synchronize({id:"g",items:[{clipId:"a"},{clipId:"b"},{clipId:"c"}],provider:p.value,correlation});
    assert.equal(r.status,"review-required");assert.equal(r.group,undefined);
    assert.equal(r.candidates.find(x=>x.clipId==="b")?.status,"matched");
    assert.equal(r.candidates.find(x=>x.clipId==="c")?.reason,"provider-error");
  });
  it("rejects an unknown reference clip",async()=>{
    await assert.rejects(()=>sync.synchronize({id:"g",items:[tc("a",0n),tc("b",1n)],referenceClipId:"missing"}),/reference/i);
  });
  it("does not invoke providers after pre-cancellation",async()=>{
    const c=new AbortController();c.abort();const p=provider({});
    await assert.rejects(()=>sync.synchronize({id:"g",items:[{clipId:"a"},{clipId:"b"}],provider:p.value,signal:c.signal}),{name:"AbortError"});
    assert.deepEqual(p.calls,[]);
  });
  it("propagates cancellation after a provider returns instead of manual fallback",async()=>{
    const c=new AbortController();
    const p: sync.AudioSampleProvider={async getSamples(){c.abort();return audio(noise(256));}};
    await assert.rejects(()=>sync.synchronize({id:"g",items:[{clipId:"a"},{clipId:"b"}],provider:p,signal:c.signal}),{name:"AbortError"});
  });
});
