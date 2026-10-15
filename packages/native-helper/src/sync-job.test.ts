import { describe,it } from 'vitest';
import assert from 'node:assert/strict';
import type { MediaService } from './media.js';
import { executeSync } from './sync-job.js';
describe('Sync decoder ownership on cancellation',()=>{
 it('waits for the pending decoder to release resources before returning cancellation',async()=>{
  let entered!:()=>void,released=false;const started=new Promise<void>(r=>{entered=r;});
  const media={info(){return {revision:'r',audio:[{}]};},read(_id:string,_window:unknown,signal:AbortSignal){
   entered();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{setTimeout(()=>{released=true;reject(new DOMException('Cancelled','AbortError'));},40);},{once:true}));
  }} as unknown as MediaService;
  const c=new AbortController();const p=executeSync('j',{kind:'sync',clips:[{clipId:'a',assetId:'a',window:{sampleCount:128}},{clipId:'b',assetId:'b',window:{sampleCount:128}}]},media,c.signal,()=>{});
  await started;c.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(released,true);
 });
});
