import {expect,it} from 'vitest';
import * as media from './index.js';
import {id,assetRecord,clip,time} from './testing/fixtures.js';
const fixture = () => ({...media.emptyCatalog(id(100)),assets:[assetRecord()],clips:[clip(),clip(3)]});
it('commits atomically and rejects stale revisions', async () => {
  const store=media.createMemoryCatalog(fixture());
  const stale=await store.read();
  expect((await store.commit(0,stale)).revision).toBe(1);
  await expect(store.commit(0,stale)).rejects.toThrow(/revision/);
  const invalid=await store.read(); invalid.clips[0].mediaAssetId='absent';
  await expect(store.commit(1,invalid)).rejects.toThrow();
  expect((await store.read()).revision).toBe(1);
});
it('keeps separate clips for repeated imports', () => {
  expect(media.validateCatalog(fixture()).clips.map(x=>x.id)).toEqual([id(2),id(3)]);
});
it('scopes host identity by adapter and project', () => {
  const state=fixture();
  const binding={bindingId:id(4),clipId:id(2),adapterId:'premiere',hostProjectKey:'p1',hostItemId:'1',hostRevision:'r1'};
  state.bindings=[binding,{...binding,bindingId:id(5),hostProjectKey:'p2'}];
  expect(media.validateCatalog(state).bindings).toHaveLength(2);
  state.bindings[1].hostProjectKey='p1';
  expect(()=>media.validateCatalog(state)).toThrow(/host identity/);
});
it('does not expose mutable internal state', async () => {
  const initial=fixture(); const store=media.createMemoryCatalog(initial);
  initial.assets[0].locations.push('bad');
  const read=await store.read(); read.clips[0].sourceRange.start.ticks=100n;
  expect((await store.read()).assets[0].locations).toEqual(['file:///shoot/A001.mov']);
  expect((await store.read()).clips[0].sourceRange.start.ticks).toBe(0n);
});
it('rejects duplicate IDs, orphan bindings and out of bounds clips', () => {
  const s=fixture(); s.assets.push(assetRecord()); expect(()=>media.validateCatalog(s)).toThrow();
  s.assets.pop();s.clips[0].sourceRange.duration=time(11n);expect(()=>media.validateCatalog(s)).toThrow();
  s.clips[0].sourceRange.duration=time(10n);s.bindings=[{bindingId:id(6),clipId:'missing',adapterId:'x',hostProjectKey:'x',hostItemId:'x',hostRevision:'x'}];
  expect(()=>media.validateCatalog(s)).toThrow();
});
