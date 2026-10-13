import { describe, it, expect } from 'vitest';
import { correlateAudio } from './audio-correlation.js';
import { snapshotAudioWindow } from './audio-provider.js';

const window=(samples:number[])=>({samples:Float32Array.from(samples),sampleRate:8000,startSample:0n});

describe('consolidation safety regressions',()=>{
  it('snapshots provider-owned mutable PCM',()=>{
    const shared=Float32Array.from([.1,.2,.3]);
    const copy=snapshotAudioWindow({samples:shared,sampleRate:8000,startSample:0n});
    shared[0]=.9;
    expect(copy.samples[0]).toBeCloseTo(.1);
  });
  it('keeps equal periodic peaks ambiguous even with zero configured margin',()=>{
    const x=Array.from({length:256},(_,i)=>Math.sin(i*Math.PI/4)*.5);
    const result=correlateAudio(window(x),window(x),{maxLagSamples:64,minOverlapSamples:64,peakExclusionSamples:1,minMargin:0});
    expect(result.status).toBe('review');
    expect(result.reason).toBe('AMBIGUOUS_PEAK');
  });
  it('rejects an exclusion radius that can hide the entire configured search',()=>{
    const x=Array.from({length:256},(_,i)=>((i*37)%101)/101-.5);
    expect(()=>correlateAudio(window(x),window(x),{maxLagSamples:20,minOverlapSamples:64,peakExclusionSamples:20}))
      .toThrow(/exclusion/i);
  });
  it('marks an otherwise accepted peak on an artificial search boundary for review',()=>{
    const x=Array.from({length:256},(_,i)=>((i*37)%101)/101-.5);
    const target=x.slice(20,180);
    const result=correlateAudio(window(x),window(target),{maxLagSamples:20,minOverlapSamples:64,minScore:.8,minMargin:.05});
    expect(result.status).toBe('review');
    expect(result.reason).toBe('SEARCH_BOUNDARY');
  });
});
