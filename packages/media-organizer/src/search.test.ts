import {expect,it} from 'vitest';
import * as media from './index.js';
import {id,assetRecord,clip} from './testing/fixtures.js';
const target={kind:'asset' as const,id:id(1)};
function fixture():media.CatalogState {
  let s={...media.emptyCatalog(id(100)),assets:[assetRecord(1,'file:///서울_인터뷰_A001.mov'),assetRecord(4,'file:///other.jpg')],clips:[clip(),clip(3)]};
  let state=media.setMetadataOverride(s,target,'deviceId','CAM_A');
  state=media.setMetadataOverride(state,target,'captureDate','2026-10-03');
  state=media.upsertAnnotation(state,{id:id(8),target,kind:'tag',value:'인물',origin:'user',reviewState:'confirmed'});
  return state;
}
it('matches NFC and NFD Korean equally without changing the URI',async()=>{
  const s=fixture(),index=media.createSearchIndex();await index.rebuild(s);
  const q={text:'서울 인터',filters:{deviceId:'CAM_A'}};
  expect(index.search(q).map(x=>x.target.id)).toEqual([id(2),id(3)]);
  expect(index.search({...q,text:q.text.normalize('NFD')})).toEqual(index.search(q));
  expect(s.assets[0].asset.uri).toBe('file:///서울_인터뷰_A001.mov');
});
it('intersects all structured filters and tag requirements',async()=>{
  const index=media.createSearchIndex();await index.rebuild(fixture());
  expect(index.search({text:'',filters:{deviceId:'CAM_A',captureDate:'2026-10-03',tags:['인물'],availability:'online'}})).toHaveLength(2);
  expect(index.search({text:'',filters:{deviceId:'CAM_A',tags:['인물','야외']}})).toEqual([]);
  expect(index.search({text:'',filters:{deviceId:'CAM_B'}})).toEqual([]);
});
it('updates asset tags across all clips without stale hits',async()=>{
  const index=media.createSearchIndex();let s=fixture();await index.rebuild(s);
  s=media.upsertAnnotation(s,{...s.annotations[0],value:'야외'});index.update(s,[target]);
  expect(index.search({text:'인물',filters:{}})).toEqual([]);
  expect(index.search({text:'야외',filters:{}}).map(x=>x.target.id)).toEqual([id(2),id(3)]);
});
it('searches unbound still assets and replaces their document when bound',async()=>{
  const index=media.createSearchIndex(),s=fixture();await index.rebuild(s);
  expect(index.search({text:'other',filters:{}})[0].target).toEqual({kind:'asset',id:id(4)});
  s.clips.push(clip(5,4));index.update(s,[{kind:'asset',id:id(4)}]);
  expect(index.search({text:'other',filters:{}}).map(x=>x.target)).toEqual([{kind:'clip',id:id(5)}]);
});
it('rebuilds without changing results and runs saved queries against fresh data',async()=>{
  const s=fixture(),index=media.createSearchIndex();s.savedSearches=[{id:id(9),name:'camera',query:{text:'서울',filters:{deviceId:'CAM_A'}}}];
  await index.rebuild(s);const first=index.search(s.savedSearches[0].query);await index.rebuild(s);
  expect(index.search(s.savedSearches[0].query)).toEqual(first);
});
it('does not let a pending rebuild overwrite a newer update',async()=>{
  let s=fixture();const index=media.createSearchIndex();const pending=index.rebuild(s);
  s=media.upsertAnnotation(s,{...s.annotations[0],value:'새태그'});index.update(s,[target]);await pending;
  expect(index.search({text:'새태그',filters:{}})).toHaveLength(2);
});
