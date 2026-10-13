import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as sync from './index.js';

const fps24 = { rate: { numerator: 24, denominator: 1 }, dropFrame: false };
const ntsc = { rate: { numerator: 30000, denominator: 1001 }, dropFrame: true };
const item = (clipId: string, timecodeTicks = 100n) => ({ clipId, timecodeTicks, frameRate: fps24, clockId: 'shoot-1-jam-A' });

test('normalizes against earliest TC with an explicit exact timebase', () => {
  const g = sync.buildTimecodeSyncGroup('g', [item('b', 125n), item('a')]);
  assert.deepEqual(g.members.map(m => m.offset.ticks), [25n, 0n]);
  assert.deepEqual(g.members[0].offset.timebase, { numerator: 1, denominator: 24 });
  assert.equal(g.referenceClipId, 'a');
  assert.equal(g.status, 'matched');
});
test('missing rate or clock identity cannot silently become exact sync', () => {
  assert.equal(sync.chooseSyncStrategy([{clipId:'a',timecodeTicks:0n},{clipId:'b',timecodeTicks:1n}]), 'manual');
  assert.throws(() => sync.buildTimecodeSyncGroup('g', [{clipId:'a',timecodeTicks:0n},item('b')]), /timecode/i);
  assert.equal(sync.chooseSyncStrategy([item('a'), {...item('b'), clockId:'other'}]), 'manual');
});
test('rejects duplicate IDs and fewer than two clips', () => {
  assert.throws(() => sync.buildTimecodeSyncGroup('g', [item('a'),item('a')]), /duplicate/i);
  assert.throws(() => sync.buildTimecodeSyncGroup('g', []), /two|2/i);
});
test('mismatched rates and DF/NDF do not match silently', () => {
  assert.equal(sync.chooseSyncStrategy([item('a'),{...item('b'),frameRate:ntsc}]), 'manual');
  assert.equal(sync.chooseSyncStrategy([{...item('a'),frameRate:ntsc},{...item('b'),frameRate:{...ntsc,dropFrame:false}}]), 'manual');
});
test('24 and 23.976 preserve exact rational frame duration', () => {
  assert.equal(sync.parseTimecode('01:00:00:00', fps24).ticks, 86400n);
  const rate = {rate:{numerator:24000,denominator:1001},dropFrame:false};
  assert.deepEqual(sync.parseTimecode('00:00:01:01',rate),{ticks:25n,timebase:{numerator:1001,denominator:24000}});
});
test('29.97 DF minute and ten-minute boundaries use physical frame counts', () => {
  assert.equal(sync.parseTimecode('00:01:00;02',ntsc).ticks,1800n);
  assert.equal(sync.parseTimecode('00:10:00;00',ntsc).ticks,17982n);
  assert.equal(sync.parseTimecode('01:00:00;00',ntsc).ticks,107892n);
  assert.equal(sync.parseTimecode('01:00:00:00',{...ntsc,dropFrame:false}).ticks,108000n);
});
test('59.94 DF and explicit midnight day offset are exact', () => {
  const rate={rate:{numerator:60000,denominator:1001},dropFrame:true};
  assert.equal(sync.parseTimecode('00:01:00;04',rate).ticks,3600n);
  assert.equal(sync.parseTimecode('00:00:00;00',ntsc,1).ticks,2589408n);
});
test('rejects skipped DF labels, bad separators and unsupported rates', () => {
  assert.throws(()=>sync.parseTimecode('00:01:00;00',ntsc), /drop|skipped/i);
  assert.throws(()=>sync.parseTimecode('00:00:00:00',ntsc), /separator/i);
  assert.throws(()=>sync.parseTimecode('24:00:00:00',fps24), /range/i);
  assert.throws(()=>sync.parseTimecode('00:00:00:24',fps24), /range/i);
  assert.throws(()=>sync.parseTimecode('00:00:00:00',{rate:{numerator:27,denominator:1},dropFrame:false}), /unsupported/i);
});
test('a fingerprint string alone is not waveform evidence', () => {
  assert.equal(sync.chooseSyncStrategy([{clipId:'a',audioFingerprint:'a'},{clipId:'b',audioFingerprint:'b'}]),'manual');
  assert.equal(sync.chooseSyncStrategy([{clipId:'a',hasAudio:true},{clipId:'b',hasAudio:true}]),'audio');
});
test('large frame counts remain bigint-exact and input is not mutated', () => {
  const start=900719925474099300n;
  const a=item('a',start), b=item('b',start+1n);
  const g=sync.buildTimecodeSyncGroup('g',[a,b]);
  assert.equal(g.members[1].offset.ticks,1n);
  assert.equal(b.timecodeTicks,start+1n);
});
