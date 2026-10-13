import {test} from 'vitest';
import assert from 'node:assert/strict';
import {SyncController} from './sync-controller.js';
import {createPremiereUxpHost,readPremiereSelection} from './premiere-host.js';
import {premiereFixture} from './test-fixtures.js';
import type {FileHelperClient} from '@pea/sync-helper-client/file';
import type {SyncGroup} from '@pea/sync';
export function matchedGroup():SyncGroup {
  const offset=(ticks:bigint)=>({ticks,timebase:{numerator:1,denominator:8000}});
  return {schemaVersion:'1.0.0',id:'g',referenceClipId:'a',strategy:'audio',status:'matched',confidence:1,
    members:[{clipId:'a',mediaAssetId:'project-1:a',offset:offset(0n),offsetTicks:0n},{clipId:'b',mediaAssetId:'project-1:b',offset:offset(2000n),offsetTicks:2000n}],
    candidates:[{referenceClipId:'a',clipId:'b',strategy:'audio',status:'matched',offset:offset(2000n),confidence:{score:1,calibrated:false},reason:'AUDIO_MATCH',provenance:{provider:'test'},evidence:[]}]};
}
const params={referenceClipId:'a',mode:'audio' as const,sampleRate:8000,startSeconds:0,durationSeconds:2};
function setup(custom?:FileHelperClient) {
  const f=premiereFixture();let sourceVersions={a:'v1',b:'v1'};
  const helper:FileHelperClient=custom??{async request(op){if(op==='sync')return{group:matchedGroup(),sourceVersions:{...sourceVersions}};if(op==='probe')return{sourceVersions:{...sourceVersions}};return{version:'0.2.0'};}};
  const controller=new SyncController({readSelection:()=>readPremiereSelection(f.ppro as never),createHost:bindings=>createPremiereUxpHost(f.ppro as never,bindings)});
  controller.connect(helper);
  return {f,controller,changeSource:()=>{sourceVersions={a:'v2',b:'v1'};}};
}
test('controller performs analyze, dry run, confirmed apply and native readback in order',async()=>{
  const {f,controller:c}=setup();await c.analyze(params);assert.equal(c.view.phase,'review');assert.equal(f.audit.length,0);
  await c.dryRun('Sync Test');assert.equal(c.view.phase,'dry-run');assert.equal(f.audit.length,0);
  const r=await c.apply(true);assert.deepEqual(r.applied,['a','b']);assert.equal(r.readbackIssues.length,0);assert.equal(c.view.phase,'completed');
});
test('apply requires both a private dry run and explicit disposable-copy consent',async()=>{
  const {f,controller:c}=setup();await assert.rejects(c.apply(true));await c.analyze(params);await c.dryRun('Test');await assert.rejects(c.apply(false),/CONFIRM/);assert.equal(f.audit.length,0);
});
test('changes after analysis invalidate dry-run rather than re-stamping a stale result',async()=>{
  const {f,controller:c}=setup();await c.analyze(params);f.items[1].path='/fixture/relinked.wav';await assert.rejects(c.dryRun('Test'),/STALE/);assert.equal(f.audit.length,0);
});
test('source change after dry-run blocks all project mutation',async()=>{
  const {f,controller:c,changeSource}=setup();await c.analyze(params);await c.dryRun('Test');changeSource();await assert.rejects(c.apply(true),/SOURCE_CHANGED/);assert.equal(f.audit.length,0);
});
test('double apply and mutable display copies cannot change the approved operations',async()=>{
  const {f,controller:c}=setup();await c.analyze(params);await c.dryRun('Test');const view=c.view;if(view.plan)view.plan.operations[0].startSeconds=999;
  const first=c.apply(true);await assert.rejects(c.apply(true));await first;assert.equal(f.sequences[1].placements[0].seconds,0);
});
test('cancellation ignores a late success from an uncooperative helper',async()=>{
  let deliver:(v:unknown)=>void=()=>{};
  const helper:FileHelperClient={request:async op=>op==='sync'?new Promise(resolve=>{deliver=resolve;}):{}};
  const {controller:c}=setup(helper);const job=c.analyze(params);await new Promise(r=>setTimeout(r,10));c.cancel();deliver({group:matchedGroup(),sourceVersions:{a:'v1',b:'v1'}});
  await job;assert.equal(c.view.phase,'cancelled');await assert.rejects(c.dryRun('Test'));
});
test('review-only audio cannot create a one-clip pretend sync',async()=>{
  const group=matchedGroup();group.status='review';group.members=group.members.slice(0,1);group.candidates[0].status='review';delete group.candidates[0].offset;
  const {f,controller:c}=setup({request:async()=>({group,sourceVersions:{a:'v1',b:'v1'}})});await c.analyze(params);await assert.rejects(c.dryRun('Test'),/MATCHED/);assert.equal(f.audit.length,0);
});
test('helper loss immediately before apply consumes the plan but makes no changes',async()=>{
  const {controller:c,f}=setup({request:async op=>{if(op==='sync')return{group:matchedGroup(),sourceVersions:{a:'v1',b:'v1'}};throw new Error('HELPER_LOST');}});
  await c.analyze(params);await c.dryRun('Test');await assert.rejects(c.apply(true),/HELPER_LOST/);await assert.rejects(c.apply(true));assert.equal(f.audit.length,0);
});
