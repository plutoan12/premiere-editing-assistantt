import { test } from "vitest";
import assert from 'node:assert/strict';
import { detectSilenceCandidates, buildRoughCutPlan } from './index.js';
import type { MediaTime } from '@pea/core';
import type { SilenceCandidate, PlanInput, PcmWindow } from './types.js';
const time = (ticks: bigint | number, denominator = 1000): MediaTime => ({ticks:BigInt(ticks),timebase:{numerator:1,denominator}});
const range = (start:number, duration:number, denominator=1000) => ({start:time(start,denominator),duration:time(duration,denominator)});
const pcm = (values:Float32Array[], start=0):PcmWindow => ({clipId:'clip-A',decoderId:'generated-pcm',sampleRate:1000,sourceStart:time(start),channels:values});
const signal = () => Float32Array.from({length:3000},(_,i)=>i>=1000&&i<2000?0:0.25);
const candidate = (id='s1',start=2000,duration=2000):SilenceCandidate => ({id,kind:'silence',clipId:'clip-A',sourceRange:range(start,duration),evidence:{decoderId:'generated-pcm',thresholdDb:-42,windowSamples:10}});
const input = (extra:Partial<PlanInput>={}):PlanInput => ({id:'p1',name:'Rough review',clipId:'clip-A',mediaDuration:time(10000),sourceRange:range(0,10000),frameRate:{rate:{numerator:24,denominator:1},dropFrame:false},candidates:[candidate()],reviews:[],protectedRanges:[],...extra});
const frames = (t:MediaTime) => t.ticks;

test('silence: handles preserve both sides of a one-second pause',()=>{
  const result=detectSilenceCandidates(pcm([signal()]));
  assert.equal(result.length,1);
  assert.deepEqual(result[0].sourceRange,range(1100,800));
});
test('silence: a short meaningful pause is not proposed',()=>{
  const a=new Float32Array(1000).fill(0.5); a.fill(0,200,500);
  assert.equal(detectSilenceCandidates(pcm([a])).length,0);
});
test('silence: opposite-polarity channels are not averaged into silence',()=>{
  assert.equal(detectSilenceCandidates(pcm([new Float32Array(1000).fill(0.5),new Float32Array(1000).fill(-0.5)])).length,0);
});
test('silence: a quiet channel cannot hide a speaking channel',()=>{
  assert.equal(detectSilenceCandidates(pcm([new Float32Array(1000),new Float32Array(1000).fill(0.5)])).length,0);
});
test('silence: preserves nonzero sample origin',()=>{
  assert.deepEqual(detectSilenceCandidates(pcm([signal()],5000))[0].sourceRange,range(6100,800));
});
test('silence: quiet trailing partial windows are included without overrun',()=>{
  assert.deepEqual(detectSilenceCandidates(pcm([new Float32Array(1005)]),{handleMs:0})[0].sourceRange,range(0,1005));
});
test('silence: repeated analysis has deterministic IDs and does not mutate PCM',()=>{
  const a=signal(); const before=a.slice(); const p=pcm([a]);
  assert.deepEqual(detectSilenceCandidates(p),detectSilenceCandidates(p)); assert.deepEqual(a,before);
});
test('silence: rejects empty channel sets and empty samples',()=>{
  assert.throws(()=>detectSilenceCandidates(pcm([])),/channel/i);
  assert.throws(()=>detectSilenceCandidates(pcm([new Float32Array()])),/sample/i);
});
test('silence: rejects unequal channel lengths and nonfinite PCM',()=>{
  assert.throws(()=>detectSilenceCandidates(pcm([new Float32Array(1000),new Float32Array(999)])),/length/i);
  assert.throws(()=>detectSilenceCandidates(pcm([Float32Array.of(NaN)])),/finite/i);
  assert.throws(()=>detectSilenceCandidates(pcm([Float32Array.of(Infinity)])),/finite/i);
});
test('silence: rejects invalid sample rate, origin and detector settings',()=>{
  assert.throws(()=>detectSilenceCandidates({...pcm([signal()]),sampleRate:0}),/sampleRate/);
  assert.throws(()=>detectSilenceCandidates({...pcm([signal()]),sourceStart:time(1,3)}),/sample grid/);
  assert.throws(()=>detectSilenceCandidates(pcm([signal()]),{thresholdDb:NaN}),/thresholdDb/);
  assert.throws(()=>detectSilenceCandidates(pcm([signal()]),{minSilenceMs:0}),/minSilenceMs/);
  assert.throws(()=>detectSilenceCandidates(pcm([signal()]),{handleMs:-1}),/handleMs/);
});
test('plan: pending candidate defaults to KEEP',()=>{
  const p=buildRoughCutPlan(input());
  assert.equal(p.plan.decisions.length,1); assert.equal(frames(p.plan.decisions[0].sourceRange.duration),240n);
  assert.deepEqual(p.pendingCandidateIds,['s1']); assert.deepEqual(p.removedRanges,[]);
});
test('plan: explicit exclusion creates two linked source ranges with contiguous destinations',()=>{
  const p=buildRoughCutPlan(input({reviews:[{candidateId:'s1',action:'exclude'}]}));
  assert.equal(p.plan.decisions.length,2);
  assert.deepEqual(p.plan.decisions.map(d=>[d.clipId,frames(d.sourceRange.start),frames(d.sourceRange.duration),frames(d.destination)]),[['clip-A',0n,48n,0n],['clip-A',96n,144n,48n]]);
});
test('plan: explicit keep preserves a meaningful pause',()=>{
  const p=buildRoughCutPlan(input({reviews:[{candidateId:'s1',action:'keep'}]}));
  assert.equal(frames(p.plan.decisions[0].sourceRange.duration),240n); assert.deepEqual(p.pendingCandidateIds,[]);
});
test('plan: locked interval wins over approved exclusion',()=>{
  const p=buildRoughCutPlan(input({reviews:[{candidateId:'s1',action:'exclude'}],protectedRanges:[range(2500,1000)]}));
  assert.deepEqual(p.removedRanges.map(r=>[frames(r.start),frames(r.duration)]),[[48n,12n],[84n,12n]]);
});
test('plan: explicit kept and pending candidates win over overlapping exclusions',()=>{
  for(const reviews of [[{candidateId:'s1',action:'exclude' as const}], [{candidateId:'s1',action:'exclude' as const},{candidateId:'s2',action:'keep' as const}]]) {
    const p=buildRoughCutPlan(input({candidates:[candidate(),candidate('s2',3000,2000)],reviews}));
    assert.deepEqual(p.removedRanges.map(r=>[frames(r.start),frames(r.duration)]),[[48n,24n]]);
  }
});
test('plan: overlapping excluded candidates are unioned rather than double removed',()=>{
  const p=buildRoughCutPlan(input({candidates:[candidate(),candidate('s2',3000,2000)],reviews:[{candidateId:'s1',action:'exclude'},{candidateId:'s2',action:'exclude'}]}));
  assert.deepEqual(p.removedRanges.map(r=>[frames(r.start),frames(r.duration)]),[[48n,72n]]);
});
test('plan: silence boundaries round inward to video frames',()=>{
  const p=buildRoughCutPlan(input({candidates:[candidate('s1',1100,800)],reviews:[{candidateId:'s1',action:'exclude'}]}));
  assert.deepEqual(p.removedRanges.map(r=>[frames(r.start),frames(r.duration)]),[[27n,18n]]);
});
test('plan: protection expands outward to whole video frames',()=>{
  const p=buildRoughCutPlan(input({reviews:[{candidateId:'s1',action:'exclude'}],protectedRanges:[range(2510,10)]}));
  assert.deepEqual(p.removedRanges.map(r=>[frames(r.start),frames(r.duration)]),[[48n,12n],[61n,35n]]);
});
test('plan: a sub-frame exclusion keeps its surrounding frames',()=>{
  const p=buildRoughCutPlan(input({candidates:[candidate('s1',2010,10)],reviews:[{candidateId:'s1',action:'exclude'}]}));
  assert.equal(frames(p.plan.decisions[0].sourceRange.duration),240n);
});
test('plan: selected source offset is retained while destination starts at zero',()=>{
  const p=buildRoughCutPlan(input({sourceRange:range(1000,5000),reviews:[{candidateId:'s1',action:'exclude'}]}));
  assert.equal(frames(p.plan.decisions[0].sourceRange.start),24n); assert.equal(frames(p.plan.decisions[0].destination),0n);
});
test('plan: 30000/1001 uses rational frame time without floating-point drift',()=>{
  const tb={numerator:1001,denominator:30000};
  const p=buildRoughCutPlan(input({frameRate:{rate:{numerator:30000,denominator:1001},dropFrame:true},sourceRange:{start:{ticks:0n,timebase:tb},duration:{ticks:300n,timebase:tb}},mediaDuration:{ticks:300n,timebase:tb},candidates:[]}));
  assert.deepEqual(p.plan.decisions[0].sourceRange.duration,{ticks:300n,timebase:tb});
});
test('plan: bigint source time beyond Number.MAX_SAFE_INTEGER remains exact',()=>{
  const n=9007199254740993n;
  const p=buildRoughCutPlan(input({sourceRange:{start:time(n,24),duration:time(240n,24)},mediaDuration:time(n+240n,24),candidates:[]}));
  assert.equal(p.plan.decisions[0].sourceRange.start.ticks,n);
});
test('plan: refuses off-frame selected source endpoints instead of silent rounding',()=>{
  assert.throws(()=>buildRoughCutPlan(input({sourceRange:range(1,9999)})),/frame-aligned/);
});
test('plan: refuses out-of-media source selections',()=>{
  assert.throws(()=>buildRoughCutPlan(input({mediaDuration:time(9000)})),/mediaDuration/);
  assert.throws(()=>buildRoughCutPlan(input({sourceRange:range(-1000,10000)})),/non-negative/);
});
test('plan: refuses unknown or duplicate reviews and invalid action values',()=>{
  assert.throws(()=>buildRoughCutPlan(input({reviews:[{candidateId:'unknown',action:'exclude'}]})),/unknown/i);
  assert.throws(()=>buildRoughCutPlan(input({reviews:[{candidateId:'s1',action:'keep'},{candidateId:'s1',action:'exclude'}]})),/duplicate/i);
  assert.throws(()=>buildRoughCutPlan(input({reviews:[{candidateId:'s1',action:'delete' as 'keep'}]})),/action/i);
});
test('plan: refuses duplicate IDs and foreign clip references',()=>{
  assert.throws(()=>buildRoughCutPlan(input({candidates:[candidate(),candidate()]})),/duplicate/i);
  assert.throws(()=>buildRoughCutPlan(input({candidates:[{...candidate(),clipId:'other'}]})),/clipId/);
});
test('plan: refuses candidate or protected ranges outside the selection',()=>{
  assert.throws(()=>buildRoughCutPlan(input({candidates:[candidate('s1',9000,2000)]})),/selection/i);
  assert.throws(()=>buildRoughCutPlan(input({protectedRanges:[range(9000,2000)]})),/selection/i);
});
test('plan: refuses zero or negative candidate duration even without a review',()=>{
  assert.throws(()=>buildRoughCutPlan(input({candidates:[candidate('s1',1000,0)]})),/positive/i);
  assert.throws(()=>buildRoughCutPlan(input({candidates:[candidate('s1',1000,-1)]})),/positive/i);
});
test('plan: rejects an empty result instead of creating an empty sequence',()=>{
  assert.throws(()=>buildRoughCutPlan(input({candidates:[candidate('s1',0,10000)],reviews:[{candidateId:'s1',action:'exclude'}]})),/empty/i);
});
test('plan: deterministic output and input objects remain unchanged',()=>{
  const data=input({reviews:[{candidateId:'s1',action:'exclude'}]}); const before=structuredClone(data);
  assert.deepEqual(buildRoughCutPlan(data),buildRoughCutPlan(data)); assert.deepEqual(data,before);
});
test('plan: fails invalid frame rate and unsafe rational integers',()=>{
  assert.throws(()=>buildRoughCutPlan(input({frameRate:{rate:{numerator:0,denominator:1},dropFrame:false}})),/positive safe integer/);
  assert.throws(()=>buildRoughCutPlan(input({mediaDuration:{ticks:10n,timebase:{numerator:1,denominator:Number.MAX_SAFE_INTEGER+1}}})),/positive safe integer/);
});
test('plan: optional duration ceiling rejects rather than inventing cuts',()=>{
  assert.throws(()=>buildRoughCutPlan(input({maxOutputFrames:100n})),/maxOutputFrames/);
});
test('plan: boundary exclusions never generate zero-length decisions',()=>{
  const p=buildRoughCutPlan(input({candidates:[candidate('s1',0,1000),candidate('s2',9000,1000)],reviews:[{candidateId:'s1',action:'exclude'},{candidateId:'s2',action:'exclude'}]}));
  assert.deepEqual(p.plan.decisions.map(d=>[frames(d.sourceRange.start),frames(d.sourceRange.duration)]),[[24n,192n]]);
});
test('integration: generated PCM -> reviewed silence -> three contiguous source edits',()=>{
  const samples=Float32Array.from({length:5000},(_,i)=>(i>=1000&&i<2000)||(i>=3000&&i<4000)?0:0.25);
  const candidates=detectSilenceCandidates(pcm([samples]));
  assert.equal(candidates.length,2);
  const p=buildRoughCutPlan(input({mediaDuration:time(5000),sourceRange:range(0,5000),candidates,reviews:candidates.map(c=>({candidateId:c.id,action:'exclude'}))}));
  assert.deepEqual(p.plan.decisions.map(d=>[d.sourceRange.start.ticks,d.sourceRange.duration.ticks,d.destination.ticks]),[[0n,27n,0n],[45n,30n,27n],[93n,27n,57n]]);
});
test('property: 200 seeded review combinations match an independent per-frame oracle',()=>{
  let seed=9137;
  const next=(max:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
  for(let round=0;round<200;round++){
    const candidates:SilenceCandidate[]=[];
    const reviews:PlanInput['reviews'][number][]=[];
    const excludes=new Array<boolean>(240).fill(false);
    const protects=new Array<boolean>(240).fill(false); protects[0]=true;
    for(let i=0;i<20;i++){
      const start=next(239),end=start+1+next(240-start);
      const c={...candidate(`p${i}`),sourceRange:range(start,end-start,24)}; candidates.push(c);
      const mode=next(3); if(mode!==2)reviews.push({candidateId:c.id,action:mode===0?'exclude':'keep'});
      for(let frame=start;frame<end;frame++) (mode===0?excludes:protects)[frame]=true;
    }
    const p=buildRoughCutPlan(input({candidates,reviews,protectedRanges:[range(0,1,24)]}));
    const expected=Array.from({length:240},(_,i)=>i).filter(i=>!excludes[i]||protects[i]);
    const actual:number[]=[]; let destination=0n;
    for(const d of p.plan.decisions){
      assert.equal(d.destination.ticks,destination); assert.ok(d.sourceRange.duration.ticks>0n);
      const end=d.sourceRange.start.ticks+d.sourceRange.duration.ticks;
      for(let f=d.sourceRange.start.ticks;f<end;f++)actual.push(Number(f));
      destination+=d.sourceRange.duration.ticks;
    }
    assert.deepEqual(actual,expected,`seeded case ${round}`);
    assert.equal(destination,BigInt(expected.length));
  }
});
