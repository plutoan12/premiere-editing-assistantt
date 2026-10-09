import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {JobRegistry} from './jobs.js';
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
describe('job cancellation ownership',()=>{
 it('does not hang wait when running work ignores cancellation',async()=>{
  const r=new JobRegistry();let release!:(v:unknown)=>void;const id=r.submit('x',()=>new Promise(ok=>{release=ok}));await tick();r.cancel(id);
  const outcome=await Promise.race([r.wait(id).then(()=>true),new Promise<boolean>(ok=>setTimeout(()=>ok(false),50))]);release(3);assert.equal(outcome,true);
 });
 it('never promotes a late result after cancellation',async()=>{
  const r=new JobRegistry();let release!:(v:unknown)=>void;const id=r.submit('x',()=>new Promise(ok=>{release=ok}));await tick();r.cancel(id);release({secret:'late'});await tick();
  assert.equal(r.get(id)?.status,'cancelled');assert.equal(r.get(id)?.result,undefined);
 });
 it('does not delete a cancelled job until underlying work finishes',async()=>{
  const r=new JobRegistry();let release!:(v:unknown)=>void;const id=r.submit('x',()=>new Promise(ok=>{release=ok}));await tick();r.cancel(id);const deleted=r.delete(id);release(0);await tick();assert.equal(deleted,false);assert.equal(r.delete(id),true);
 });
 it('does not expose mutable internal result objects',async()=>{
  const r=new JobRegistry();const id=r.submit('x',async()=>({value:1}));await r.wait(id);(r.get(id)!.result as {value:number}).value=2;assert.deepEqual(r.get(id)!.result,{value:1});
 });
});
describe('job capacity',()=>{
 it('bounds retained jobs and concurrent operations',async()=>{
  const r=new JobRegistry({maxJobs:2,maxConcurrent:1});let release!:(v:unknown)=>void;
  const a=r.submit('x',()=>new Promise(ok=>{release=ok}));const b=r.submit('x',async()=>2);await tick();
  const state=r.get(b)?.status;let rejected=false;try{r.submit('x',async()=>3)}catch{rejected=true}
  release(1);await r.wait(a);await r.wait(b);assert.equal(state,'queued');assert.equal(rejected,true);
 });
 it('allows cancelling queued jobs without starting their work',async()=>{
  const r=new JobRegistry();let calls=0;const id=r.submit('x',async()=>{calls++;return 1});r.cancel(id);await r.wait(id);await tick();assert.equal(calls,0);
 });
});
