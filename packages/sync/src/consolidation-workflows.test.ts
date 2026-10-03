import { describe,it,expect } from 'vitest';
import type { SequencePlan } from '@pea/core';
import { buildMulticamGroups, resyncArtifacts, syncPlaybackBatch } from './index.js';
import type { AudioSampleProvider, SyncEvidence } from './index.js';

const rate={rate:{numerator:24,denominator:1},dropFrame:false};
const tc=(clipId:string,ticks:bigint,extra:Partial<SyncEvidence & {duration:{ticks:bigint,timebase:{numerator:number,denominator:number}}}>={})=>({
 clipId,timecodeTicks:ticks,frameRate:rate,clockId:'day1',duration:{ticks:100n,timebase:{numerator:1,denominator:24}},...extra
});
const mt=(ticks:bigint)=>({ticks,timebase:{numerator:1,denominator:24}});
const range=(start:bigint,duration:bigint)=>({start:mt(start),duration:mt(duration)});

describe('consolidated workflow regressions',()=>{
 it('preserves camera/source/role identity in multicam members',()=>{
   const r=buildMulticamGroups('shoot',[
     tc('cam',0n,{sourceId:'s1',cameraId:'A',role:'camera'}),
     tc('rec',1n,{sourceId:'s2',cameraId:'R',role:'recorder'})
   ] as any);
   expect(r.groups[0].members[1]).toMatchObject({sourceId:'s2',cameraId:'R',role:'recorder'});
 });
 it('keeps successful playback takes when one provider read fails',async()=>{
   const source=Float32Array.from({length:256},(_,i)=>(((i*37)%101)/101-.5));
   const provider:AudioSampleProvider={id:'test',version:'1',async read(clip){
     if(clip.clipId==='bad') throw new Error('decode failed');
     const offset=clip.clipId==='good'?20:0;
     return {samples:source.slice(offset,offset+180),sampleRate:8000,startSample:0n};
   }};
   const r=await syncPlaybackBatch('mv',{clipId:'master',hasAudio:true},[
     {clipId:'bad',hasAudio:true},{clipId:'good',hasAudio:true}
   ],{audioProvider:provider,audio:{maxLagSamples:50,minOverlapSamples:64,minScore:.8,minMargin:.05}});
   expect(r).toHaveLength(2);
   expect(r.find(x=>x.takeId==='bad')!.group.status).toBe('review');
   expect(r.find(x=>x.takeId==='good')!.group.status).toBe('matched');
 });
 it('treats a full source occurrence plus a partial duplicate as conflict',()=>{
   const artifacts=[{id:'caption',clipId:'a',sourceRange:range(10n,10n)}];
   const revised:SequencePlan={id:'seq',name:'seq',decisions:[
     {id:'full',clipId:'a',sourceRange:range(0n,100n),destination:mt(0n)},
     {id:'partial',clipId:'a',sourceRange:range(15n,50n),destination:mt(200n)}
   ]} as SequencePlan;
   const r=resyncArtifacts(artifacts,revised);
   expect(r.mapped).toHaveLength(0);
   expect(r.conflicted).toHaveLength(1);
 });
});
