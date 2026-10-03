import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as sync from "./index.js";
import { audio, noise } from "./test-fixtures.js";

const options={maxOffsetSamples:160,minOverlapSamples:64};
describe("normalized audio correlation",()=>{
  it("recovers a truncated take's positive start offset",()=>{
    const x=noise(512); const r=sync.correlateAudio(audio(x),audio(x.slice(73,329)),options);
    assert.equal(r.status,"matched"); assert.equal(r.offsetSamples,73); assert.ok(r.score>0.999999);
  });
  it("recovers negative offsets with head silence",()=>{
    const x=noise(256);const y=new Float64Array(306);y.set(x,50);
    const r=sync.correlateAudio(audio(x),audio(y),options);
    assert.equal(r.status,"matched");assert.equal(r.offsetSamples,-50);
  });
  it("recovers zero offset",()=>{
    const x=noise(256);assert.equal(sync.correlateAudio(audio(x),audio(x),options).offsetSamples,0);
  });
  it("tolerates gain and DC offset",()=>{
    const x=noise(512);const y=x.slice(31,331).map(v=>v*0.6+0.15);
    const r=sync.correlateAudio(audio(x),audio(y),options);
    assert.equal(r.status,"matched");assert.equal(r.offsetSamples,31);
  });
  it("recognizes inverted polarity and records it",()=>{
    const x=noise(512); const r=sync.correlateAudio(audio(x),audio(x.slice(21,321).map(v=>-v)),options);
    assert.equal(r.offsetSamples,21); assert.equal(r.polarity,-1);assert.equal(r.status,"matched");
  });
  it("does not accept silence or a constant DC signal",()=>{
    for(const x of [new Float64Array(256),new Float64Array(256).fill(0.4)]) {
      const r=sync.correlateAudio(audio(x),audio(x),options);
      assert.equal(r.status,"review-required");assert.equal(r.reason,"silence");assert.equal(r.offsetSamples,null);
    }
  });
  it("flags repeated periodic peaks instead of inventing certainty",()=>{
    const x=Float64Array.from({length:512},(_,i)=>Math.sin(i*Math.PI/4)*0.5);
    const r=sync.correlateAudio(audio(x),audio(x),{...options,peakExclusionSamples:1});
    assert.equal(r.status,"review-required");assert.equal(r.reason,"ambiguous");assert.ok(r.margin<0.01);
  });
  it("does not sync unrelated noise",()=>{
    const r=sync.correlateAudio(audio(noise(512,1)),audio(noise(512,77)),options);
    assert.equal(r.status,"review-required");assert.equal(r.reason,"low-confidence");
  });
  it("requires enough overlapping samples",()=>{
    const r=sync.correlateAudio(audio(noise(16)),audio(noise(16)),options);
    assert.equal(r.status,"review-required");assert.equal(r.reason,"insufficient-overlap");
  });
  it("flags a best match at the configured search boundary",()=>{
    const x=noise(512);const r=sync.correlateAudio(audio(x),audio(x.slice(31,331)),{...options,maxOffsetSamples:31});
    assert.equal(r.status,"review-required");assert.equal(r.reason,"search-boundary");
  });
  it("does not silently resample different sample rates",()=>{
    assert.throws(()=>sync.correlateAudio(audio(noise(256)),audio(noise(256),0,48000),options),/sample.rate/i);
  });
  it("rejects invalid samples and metadata before matching",()=>{
    for(const samples of [[NaN],[Infinity],[1.1]]) assert.throws(()=>sync.correlateAudio(audio(samples),audio(noise(256)),options));
    assert.throws(()=>sync.correlateAudio(audio(noise(256),-1),audio(noise(256)),options));
    assert.throws(()=>sync.correlateAudio(audio(noise(256),0,0),audio(noise(256)),options));
  });
  it("bounds memory rather than silently truncating oversized windows",()=>{
    assert.throws(()=>sync.correlateAudio(audio(new Float64Array(262145)),audio(noise(256)),options),/window|limit/i);
  });
  it("rejects unsafe correlation settings",()=>{
    for(const bad of [{minScore:1.1},{minMargin:-1},{maxOffsetSamples:-1},{minOverlapSamples:1},{peakExclusionSamples:-1}]) {
      assert.throws(()=>sync.correlateAudio(audio(noise(256)),audio(noise(256)),{...options,...bad}));
    }
  });
  it("honors pre-existing cancellation",()=>{
    const controller=new AbortController();controller.abort();
    assert.throws(()=>sync.correlateAudio(audio(noise(256)),audio(noise(256)),{...options,signal:controller.signal}),{name:"AbortError"});
  });
  it("matches several seeded shifts within one sample",()=>{
    for(let seed=1;seed<=12;seed++) {
      const x=noise(900,seed),offset=seed*7;
      const r=sync.correlateAudio(audio(x),audio(x.slice(offset,offset+500)),options);
      assert.equal(r.status,"matched");assert.equal(r.offsetSamples,offset);
    }
  });
});
