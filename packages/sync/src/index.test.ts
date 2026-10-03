import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chooseSyncStrategy, buildTimecodeSyncGroup, syncClips, syncPlayback, resyncArtifacts } from './index.js';
test('public API exports independent engines and fails closed on legacy incomplete TC',()=>{
  assert.equal(typeof syncClips,'function');assert.equal(typeof syncPlayback,'function');assert.equal(typeof resyncArtifacts,'function');
  assert.equal(chooseSyncStrategy([{clipId:'a',timecodeTicks:10n},{clipId:'b',timecodeTicks:20n}]),'manual');
});
test('legacy offsetTicks alias is preserved only alongside an explicit timebase',()=>{
  const evidence=(clipId:string,ticks:bigint)=>({clipId,timecodeTicks:ticks,clockId:'jam',frameRate:{rate:{numerator:24,denominator:1},dropFrame:false}});
  const group=buildTimecodeSyncGroup('g',[evidence('a',100n),evidence('b',125n)]);
  assert.deepEqual(group.members.map(x=>x.offsetTicks),[0n,25n]);
  assert.deepEqual(group.members[1].offset.timebase,{numerator:1,denominator:24});
});
