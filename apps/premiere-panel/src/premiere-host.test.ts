import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createPremiereUxpHost } from './premiere-host.js';
import * as hostModule from './premiere-host.js';
import { premiereFixture } from './test-fixtures.js';
const op={kind:'place' as const,clipId:'a',projectItemId:'a',startSeconds:1.25,trackIndex:0,quantizationErrorSeconds:0};
test('selected file paths and active template are resolved through native APIs',async()=>{
 const f=premiereFixture();
 assert.equal(typeof hostModule.readPremiereSelection,'function');
 const selection=await hostModule.readPremiereSelection(f.ppro);
 assert.equal(selection.clips[0].path,'/fixture/a.wav');assert.equal(selection.frameRate.numerator/selection.frameRate.denominator,24);
});
test('snapshot detects relink and source in-point changes under stable item ids',async()=>{
 const f=premiereFixture(),h=createPremiereUxpHost(f.ppro,[{clipId:'a',projectItemId:'a'}]);
 const before=await h.snapshot();f.items[0].path='/fixture/relinked.wav';
 assert.notEqual((await h.snapshot()).projectVersion,before.projectVersion);
});
test('native Actions are created inside locked synchronous transactions',async()=>{
 const f=premiereFixture(),h=createPremiereUxpHost(f.ppro,[{clipId:'a',projectItemId:'a'}]);
 await h.snapshot();const id=await h.createSyncSequence('PEA Sync');await h.placeClip(id,op);
 assert.equal(f.sequences[1].placements[0].seconds,1.25);
});
test('dedicated empty sequence inherits template settings without copying clips',async()=>{
 const f=premiereFixture();f.template.settings.ticksPerFrame='8475667200';
 const h=createPremiereUxpHost(f.ppro,[{clipId:'a',projectItemId:'a'}]);await h.snapshot();await h.createSyncSequence('Sync');
 assert.equal(f.sequences[1].settings.ticksPerFrame,'8475667200');assert.equal(f.sequences[1].placements.length,0);
});
test('project switch cannot reuse native objects belonging to the old project',async()=>{
 const f=premiereFixture(),h=createPremiereUxpHost(f.ppro,[{clipId:'a',projectItemId:'a'}]);
 await h.snapshot();const id=await h.createSyncSequence('Sync');f.switchProject();
 await assert.rejects(()=>h.placeClip(id,op),/project/i);assert.equal(f.sequences[1].placements.length,0);
});
test('the host never applies to a sequence it did not create',async()=>{
 const f=premiereFixture(),h=createPremiereUxpHost(f.ppro,[{clipId:'a',projectItemId:'a'}]);
 await assert.rejects(()=>h.placeClip('template',op),/owned|dedicated/i);
});
test('name collision causes no sequence creation',async()=>{
 const f=premiereFixture(),h=createPremiereUxpHost(f.ppro,[{clipId:'a',projectItemId:'a'}]);
 await assert.rejects(()=>h.createSyncSequence('Template'),/exists/i);assert.equal(f.audit.length,0);
});
test('offline media is not silently admitted',async()=>{
 const f=premiereFixture();f.items[0].offline=true;
 assert.equal(typeof hostModule.readPremiereSelection,'function');
 await assert.rejects(()=>hostModule.readPremiereSelection(f.ppro),/offline/i);
});
test('native readback checks actual inserted positions, not only transaction return values',async()=>{
 const f=premiereFixture(),h=createPremiereUxpHost(f.ppro,[{clipId:'a',projectItemId:'a'}]);
 await h.snapshot();const id=await h.createSyncSequence('Sync');await h.placeClip(id,op);
 assert.deepEqual(await h.verifyPlacements(id,[op]),[]);
 f.sequences[1].placements[0].seconds=9;
 assert.equal((await h.verifyPlacements(id,[op])).length,1);
});

test('new sequence auto-activation does not change the pinned settings template', async () => {
  const f=premiereFixture(), original=f.project.createSequence;
  f.project.createSequence=async(...args)=>{const s=await original(...args);f.project.getActiveSequence=async()=>s;return s;};
  const h=createPremiereUxpHost(f.ppro as never);await h.snapshot();const sequenceId=await h.createSyncSequence('New');
  await h.placeClip(sequenceId,{kind:'place',clipId:'a',projectItemId:'a',startSeconds:0,trackIndex:0,quantizationErrorSeconds:0});
  assert.equal(f.sequences[1].placements.length,1);
});
test('native readback exposes foreign clips on an allocated track',async()=>{
  const f=premiereFixture(),h=createPremiereUxpHost(f.ppro as never);await h.snapshot();const sequenceId=await h.createSyncSequence('New');
  const op={kind:'place' as const,clipId:'a',projectItemId:'a',startSeconds:0,trackIndex:0,quantizationErrorSeconds:0};
  await h.placeClip(sequenceId,op);f.sequences[1].placements.push({item:f.items[1],seconds:2,video:0,audio:0});
  assert.ok((await h.verifyPlacements(sequenceId,[op])).some(x=>x.includes('unexpected')));
});
test('sequence creation changing Project-panel selection does not lose approved source handles',async()=>{
  const f=premiereFixture(),create=f.project.createSequence;
  f.project.createSequence=async(...args)=>{const s=await create(...args);f.select([]);return s;};
  const h=createPremiereUxpHost(f.ppro as never);await h.snapshot();const sequenceId=await h.createSyncSequence('New');
  await h.placeClip(sequenceId,{kind:'place',clipId:'a',projectItemId:'a',startSeconds:0,trackIndex:0,quantizationErrorSeconds:0});
  assert.equal(f.sequences[1].placements[0].item.getId(),'a');
});
