import { describe,it } from 'vitest';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MediaService } from './media.js';
import { json } from './protocol.js';
import * as api from './sync-job.js';
import { withMedia,writeWave,noise,ffmpeg,ffprobe } from './test-fixtures.js';
async function setup(root:string,periodic=false){
 const x=periodic?Float32Array.from({length:16000},(_,i)=>Math.sin(i*Math.PI/4)*.4):noise(16000);
 await writeWave(join(root,'master.wav'),x);await writeWave(join(root,'take.wav'),x.slice(500));
 const media=await MediaService.create({roots:[root],ffmpeg,ffprobe});const a=await media.register(join(root,'master.wav')),b=await media.register(join(root,'take.wav'));
 return {media,a,b,request:{kind:'sync',clips:[{clipId:'master',assetId:a.assetId,window:{sampleCount:8000}},{clipId:'take',assetId:b.assetId,window:{sampleCount:8000}}]}};
}
describe('FFmpeg -> consolidated Sync engine',()=>{
 it('recovers a known 500-sample placement from real WAV files',async()=>withMedia(async root=>{
  assert.equal(typeof api.executeSync,'function');const {media,request}=await setup(root);const progress:number[]=[];
  const r=await api.executeSync('job',request,media,new AbortController().signal,p=>progress.push(p));
  assert.equal(r.group.status,'matched');assert.equal(r.group.candidates[0].offset?.ticks,500n);assert.equal(r.group.candidates[0].offset?.timebase.denominator,8000);
  assert.equal(r.inputs.length,2);assert.ok(r.inputs.every(x=>typeof x.pcmSha256==='string'));assert.equal(progress.at(-1),1);
  const transport=JSON.parse(json(r));assert.equal(transport.group.candidates[0].offset.ticks,'500');
 }));
 it('preserves signed negative placement with a selected reference',async()=>withMedia(async root=>{
  const {media,request}=await setup(root);const r=await api.executeSync('job',{...request,referenceClipId:'take'},media,new AbortController().signal,()=>{});
  assert.equal(r.group.candidates[0].offset?.ticks,-500n);
 }));
 it('does not turn a repeated audio pattern into a match',async()=>withMedia(async root=>{
  const {media,request}=await setup(root,true);const r=await api.executeSync('job',request,media,new AbortController().signal,()=>{});
  assert.equal(r.group.status,'review');assert.equal(r.group.candidates[0].offset,undefined);
 }));
 it('retains a valid match when another registered file changed',async()=>withMedia(async root=>{
  const {media,request}=await setup(root);await writeWave(join(root,'third.wav'),noise(16000));const c=await media.register(join(root,'third.wav'));await writeFile(join(root,'third.wav'),'corrupt');
  const r=await api.executeSync('job',{...request,clips:[...request.clips,{clipId:'broken',assetId:c.assetId,window:{sampleCount:8000}}]},media,new AbortController().signal,()=>{});
  assert.equal(r.group.status,'partial');assert.equal(r.group.candidates.find(x=>x.clipId==='take')?.status,'matched');assert.equal(r.group.candidates.find(x=>x.clipId==='broken')?.reason,'PROVIDER_ERROR');
 }));
 it('rejects mixed output rates rather than silently resampling again',async()=>withMedia(async root=>{
  const {media,request}=await setup(root);request.clips[1].window={sampleCount:8000,sampleRate:16000} as any;
  await assert.rejects(api.executeSync('job',request,media,new AbortController().signal,()=>{}),{code:'INVALID_REQUEST'});
 }));
 it('rejects duplicate clip IDs and excessive batch size',()=>{
  assert.equal(typeof api.parseSyncRequest,'function');const clip={clipId:'a',assetId:'a'};
  assert.throws(()=>api.parseSyncRequest({kind:'sync',clips:[clip,clip]}));assert.throws(()=>api.parseSyncRequest({kind:'sync',clips:Array(17).fill(clip)}));
 });
 it('propagates cancellation without claiming review/success',async()=>withMedia(async root=>{
  const {media,request}=await setup(root);await assert.rejects(api.executeSync('job',request,media,AbortSignal.abort(),()=>{}),{name:'AbortError'});
 }));
});
