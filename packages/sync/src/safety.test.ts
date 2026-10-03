import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as sync from "./index.js";
import { correlationProducts } from "./fft.js";
import { audio, noise } from "./test-fixtures.js";

describe("review regressions",()=>{
  it("FFT products equal an independent direct sum at every signed lag",()=>{
    for(const [n,m] of [[17,29],[64,39],[51,51]]) {
      const a=noise(n,7),b=noise(m,42),actual=correlationProducts(a,b);
      for(let lag=1-m;lag<n;lag++) {
        let expected=0;
        for(let j=0;j<m;j++) if(j+lag>=0&&j+lag<n) expected+=a[j+lag]*b[j];
        assert.ok(Math.abs(actual[m-1+lag]-expected)<1e-9,`lag ${lag}`);
      }
    }
  });
  it("never accepts equal periodic peaks even when minimum margin is zero",()=>{
    const x=Float64Array.from({length:512},(_,i)=>Math.sin(i*Math.PI/4)*0.5);
    const r=sync.correlateAudio(audio(x),audio(x),{maxOffsetSamples:100,minOverlapSamples:64,peakExclusionSamples:1,minMargin:0});
    assert.equal(r.status,"review-required");assert.equal(r.reason,"ambiguous");
  });
  it("does not permit an exclusion radius that hides the entire search",()=>{
    const x=noise(512);
    assert.throws(()=>sync.correlateAudio(audio(x),audio(x),{maxOffsetSamples:100,peakExclusionSamples:200}),/exclusion|peak/i);
  });
  it("snapshots provider buffers before the decoder reuses them",async()=>{
    const original=noise(512),shared=new Float64Array(512);
    const provider:sync.AudioSampleProvider={async getSamples(id){
      if(id==="a") {shared.set(original);return {samples:shared,sampleRate:8000,startSample:0};}
      shared.fill(0);shared.set(original.slice(30,330));
      return {samples:shared.subarray(0,300),sampleRate:8000,startSample:0};
    }};
    const r=await sync.synchronize({id:"g",items:[{clipId:"a"},{clipId:"b"}],provider,correlation:{maxOffsetSamples:100,minOverlapSamples:64}});
    assert.equal(r.status,"synced");assert.equal(r.group?.members[1].offsetTicks,30n);
  });
  it("keeps the playback master cache immutable when decoder buffers are reused",async()=>{
    const original=noise(512),shared=new Float64Array(512);
    const provider:sync.AudioSampleProvider={async getSamples(id){
      if(id==="master") {shared.set(original);return {samples:shared,sampleRate:8000,startSample:0};}
      const offset=id==="one"?20:60;shared.fill(0);shared.set(original.slice(offset,offset+300));
      return {samples:shared.subarray(0,300),sampleRate:8000,startSample:0};
    }};
    const r=await sync.syncPlayback({id:"mv",reference:{clipId:"master"},takes:[{clipId:"one"},{clipId:"two"}],provider,correlation:{maxOffsetSamples:100,minOverlapSamples:64}});
    assert.equal(r[0].result.group?.members[1].offsetTicks,20n);assert.equal(r[1].result.group?.members[1].offsetTicks,60n);
  });
  it("releases a cancelled caller even when a provider ignores the signal",async()=>{
    const c=new AbortController();
    const provider:sync.AudioSampleProvider={getSamples(){queueMicrotask(()=>c.abort());return new Promise(()=>{});}};
    await assert.rejects(()=>sync.synchronize({id:"g",items:[{clipId:"a"},{clipId:"b"}],provider,signal:c.signal}),{name:"AbortError"});
  });
  it("flags a full source repeat plus a partially trimmed repeat as conflict",()=>{
    const t=(ticks:bigint)=>({ticks,timebase:{numerator:1,denominator:24}});
    const r=(start:bigint,duration:bigint)=>({start:t(start),duration:t(duration)});
    const result=sync.resyncArtifacts([{id:"caption",clipId:"a",sourceRange:r(10n,10n)}],[
      {id:"full",clipId:"a",sourceRange:r(0n,100n),sequenceStart:t(0n)},
      {id:"partial",clipId:"a",sourceRange:r(15n,50n),sequenceStart:t(200n)}]);
    assert.equal(result.mapped.length,0);assert.equal(result.conflicted[0].candidates.length,2);
  });
});
