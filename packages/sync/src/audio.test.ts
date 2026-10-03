import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as sync from './index.js';

function noise(n: number, seed=123): Float32Array {
  let state=seed;
  return Float32Array.from({length:n},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state/4294967296-.5);});
}
const windowOf=(samples:Float32Array,sampleRate=8000,startSample=0n)=>({samples,sampleRate,startSample});
const a=noise(512);

test('recovers a positive non-grid sample offset from a truncated take',()=>{
  const r=sync.correlateAudio(windowOf(a),windowOf(a.slice(73,440)));
  assert.equal(r.status,'matched'); assert.equal(r.offsetSamples,73); assert.ok(r.score>.999);
});
test('leading head silence returns negative placement offset',()=>{
  const b=new Float32Array(a.length+47); b.set(a,47);
  assert.equal(sync.correlateAudio(windowOf(a),windowOf(b)).offsetSamples,-47);
});
test('gain/DC/polarity changes preserve alignment without mutating samples',()=>{
  const before=a.slice();
  const b=Float32Array.from(a.slice(37,430),v=>-v*.7+.1);
  const r=sync.correlateAudio(windowOf(a),windowOf(b));
  assert.equal(r.status,'matched'); assert.equal(r.offsetSamples,37); assert.equal(r.polarity,'inverted');
  assert.deepEqual(a,before);
});
test('silence and constant DC do not produce an accepted offset',()=>{
  for(const samples of [new Float32Array(512),new Float32Array(512).fill(.1)]) {
    const r=sync.correlateAudio(windowOf(a),windowOf(samples));
    assert.equal(r.status,'review'); assert.equal(r.reason,'SILENCE'); assert.equal(r.offsetSamples,null);
  }
});
test('repeated periodic waveforms expose second-best ambiguity',()=>{
  const periodic=Float32Array.from({length:512},(_,i)=>Math.sin(i*2*Math.PI/16)*.5);
  const r=sync.correlateAudio(windowOf(periodic),windowOf(periodic));
  assert.equal(r.status,'review'); assert.equal(r.reason,'AMBIGUOUS_PEAK'); assert.equal(r.offsetSamples,null);
  assert.ok(r.secondBestScore>.99);
});
test('unrelated/low-SNR signals remain review-required',()=>{
  const r=sync.correlateAudio(windowOf(a),windowOf(noise(512,4321)));
  assert.equal(r.status,'review'); assert.equal(r.reason,'LOW_CORRELATION'); assert.equal(r.offsetSamples,null);
});
test('search window is enforced rather than returning an out-of-range match',()=>{
  const r=sync.correlateAudio(windowOf(a),windowOf(a.slice(80)),{maxLagSamples:20});
  assert.equal(r.status,'review'); assert.equal(r.offsetSamples,null);
});
test('rejects invalid audio and options and surfaces mismatched sample rates',()=>{
  assert.equal(sync.correlateAudio(windowOf(a),windowOf(a,48000)).reason,'SAMPLE_RATE_MISMATCH');
  assert.throws(()=>sync.correlateAudio(windowOf(Float32Array.of(NaN)),windowOf(a)),/finite|normalized/i);
  assert.throws(()=>sync.correlateAudio(windowOf(a,0),windowOf(a)),/sample/i);
  assert.throws(()=>sync.correlateAudio(windowOf(a),windowOf(a),{minScore:1.1}),/score/i);
  assert.throws(()=>sync.correlateAudio(windowOf(a),windowOf(a),{maxLagSamples:-1}),/lag/i);
  assert.equal(sync.correlateAudio(windowOf(new Float32Array(8)),windowOf(a)).reason,'INSUFFICIENT_OVERLAP');
});
test('bounded long-buffer FFT finds an exact single-sample offset',()=>{
  const large=noise(16000,921);
  const r=sync.correlateAudio(windowOf(large),windowOf(large.slice(1357,15000)));
  assert.equal(r.status,'matched'); assert.equal(r.offsetSamples,1357);
});
test('correlation propagates cancellation',()=>{
  const controller=new AbortController();controller.abort();
  assert.throws(()=>sync.correlateAudio(windowOf(a),windowOf(a),{signal:controller.signal}),{name:'AbortError'});
});

const clips=[{clipId:'ref',hasAudio:true},{clipId:'take',hasAudio:true}];
function provider(windows:Record<string,ReturnType<typeof windowOf>>) {
  return {id:'synthetic',version:'1',async read(clip:{clipId:string}) {
    const result=windows[clip.clipId]; if(!result) throw new Error('decode failed'); return result;
  }};
}
test('orchestrator uses compatible TC without opening the audio provider',async()=>{
  const rate={rate:{numerator:24,denominator:1},dropFrame:false};
  const items=clips.map((c,i)=>({...c,clockId:'jam',frameRate:rate,timecodeTicks:BigInt(i*24)}));
  const g=await sync.syncClips('g',items,{audioProvider:provider({})});
  assert.equal(g.strategy,'timecode'); assert.equal(g.status,'matched');assert.equal(g.members[1].offset.ticks,24n);
});
test('audio fallback accounts for nonzero analysis window origins exactly',async()=>{
  const g=await sync.syncClips('g',clips,{audioProvider:provider({ref:windowOf(a,8000,1000n),take:windowOf(a.slice(73,440),8000,200n)})});
  assert.equal(g.strategy,'audio');assert.equal(g.status,'matched');
  assert.deepEqual(g.members[1].offset,{ticks:873n,timebase:{numerator:1,denominator:8000}});
  assert.equal(g.candidates[0].provenance.provider,'synthetic');assert.ok(g.candidates[0].evidence.length>0);
});
test('partial success preserves valid members but never invents failed offsets',async()=>{
  const items=[...clips,{clipId:'bad',hasAudio:true}];
  const g=await sync.syncClips('g',items,{audioProvider:provider({ref:windowOf(a),take:windowOf(a.slice(20))})});
  assert.equal(g.status,'partial');assert.equal(g.members.length,2);
  const bad=g.candidates.find(x=>x.clipId==='bad')!;
  assert.equal(bad.status,'review');assert.equal(bad.reason,'PROVIDER_ERROR');assert.equal(bad.offset,undefined);
});
test('all-manual result is review, not a synchronized group',async()=>{
  const g=await sync.syncClips('g',[{clipId:'ref'},{clipId:'take'}]);
  assert.equal(g.status,'review');assert.equal(g.confidence,0);assert.equal(g.members.length,1);
});
test('sample-rate mismatch is visible in orchestrator review reason',async()=>{
  const g=await sync.syncClips('g',clips,{audioProvider:provider({ref:windowOf(a),take:windowOf(a,48000)})});
  assert.equal(g.status,'review');assert.equal(g.candidates[0].reason,'SAMPLE_RATE_MISMATCH');
});
test('pre-cancellation and cancellation during decoding do not become provider failure',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>sync.syncClips('g',clips,{signal:controller.signal}),{name:'AbortError'});
  const c=new AbortController();
  await assert.rejects(()=>sync.syncClips('g',clips,{signal:c.signal,audioProvider:{id:'abort',version:'1',async read(){c.abort();return windowOf(a);}}}),{name:'AbortError'});
});
test('the reference window is reused within a batch',async()=>{
  let reads=0;
  const base=provider({ref:windowOf(a),take:windowOf(a.slice(20)),third:windowOf(a.slice(40))});
  const p={...base,async read(clip:{clipId:string}){if(clip.clipId==='ref')reads++;return base.read(clip);}};
  const g=await sync.syncClips('g',[...clips,{clipId:'third',hasAudio:true}],{audioProvider:p});
  assert.equal(g.members.length,3);assert.equal(reads,1);
});
test('cancellation exits even when a decoder ignores its AbortSignal',async()=>{
  const controller=new AbortController();
  let timeout:ReturnType<typeof setTimeout>|undefined;
  const job=sync.syncClips('g',clips,{signal:controller.signal,audioProvider:{id:'stuck',version:'1',
    async read(){setTimeout(()=>controller.abort(),5);return new Promise<ReturnType<typeof windowOf>>(()=>{});}}});
  try {
    await assert.rejects(()=>Promise.race([job,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('decoder cancellation timed out')),100);})]),{name:'AbortError'});
  } finally {if(timeout)clearTimeout(timeout);}
});
test('150 seeded positive and negative offsets are recovered without sample rounding',()=>{
  for(let seed=1;seed<=25;seed++) {
    const reference=noise(1024,seed);
    for(const shift of [1,31,137]) {
      const cropped=reference.slice(shift,900);
      assert.equal(sync.correlateAudio(windowOf(reference),windowOf(cropped)).offsetSamples,shift);
      const padded=new Float32Array(1024+shift);padded.set(reference,shift);
      assert.equal(sync.correlateAudio(windowOf(reference),windowOf(padded)).offsetSamples,-shift);
    }
  }
});
