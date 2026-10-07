import {expect,it} from 'vitest';
import * as media from './index.js';
import {id,assetRecord,clip,time} from './testing/fixtures.js';
const target={kind:'asset' as const,id:id(1)};
const candidate=(value:string)=>({field:'captureDate' as const,value,source:'probe' as const,provenance:{provider:'fixture'}});
const fixture=():media.CatalogState=>({...media.emptyCatalog(id(100)),assets:[assetRecord()],clips:[clip()]});
it('reports conflicting automatic dates and retains their sources',()=>{
  const r=media.resolveMetadata({target,field:'captureDate',candidates:[candidate('2026-10-03'),candidate('2026-10-04')]});
  expect(r.status).toBe('conflict');expect(r.value).toBeUndefined();expect(r.reasons).toHaveLength(2);
});
it('keeps a date without timezone unchanged',()=>{
  expect(media.resolveMetadata({target,field:'captureDate',candidates:[candidate('2026-10-03')]}).value).toBe('2026-10-03');
});
it('keeps locked override after new probe while preserving notes and tags',async()=>{
  let s=media.setMetadataOverride(fixture(),target,'captureDate','2026-10-02');
  s=media.upsertAnnotation(s,{id:id(9),target,kind:'note',value:'keep this',origin:'user',reviewState:'confirmed'});
  s=media.upsertAnnotation(s,{id:id(10),target,kind:'tag',value:'interview',origin:'user',reviewState:'confirmed'});
  const store=media.createMemoryCatalog(s);let n=1000;
  await media.ingest([{scanId:id(50),uri:s.assets[0].asset.uri,existingAssetId:id(1)}],{store,ids:()=>id(n++),providerVersion:'v2',settingsKey:'default',files:{stat:async()=>({size:1n,mtimeNs:1n}),sha256:async()=> 'a'.repeat(64)},probe:{probe:async()=>({mediaKind:'video',duration:time(10n),candidates:[candidate('2026-10-04')]})}});
  const after=await store.read();expect(media.effectiveMetadata(target,after,'captureDate').value).toBe('2026-10-02');
  expect(after.annotations.map(x=>x.value)).toEqual(['keep this','interview']);
});
it('inherits asset override and allows clip override to take precedence',()=>{
  let s=media.setMetadataOverride(fixture(),target,'deviceId','A');
  const ct={kind:'clip' as const,id:id(2)};
  expect(media.effectiveMetadata(ct,s,'deviceId').value).toBe('A');
  s=media.setMetadataOverride(s,ct,'deviceId','B');expect(media.effectiveMetadata(ct,s,'deviceId').value).toBe('B');
  s=media.setMetadataOverride(s,ct,'deviceId',null);expect(media.effectiveMetadata(ct,s,'deviceId').value).toBe('A');
});
it('distinguishes clearing a value from removing an override',()=>{
  let s=fixture();s.metadata=[{target,field:'captureDate',candidates:[candidate('2026-10-03')]}];
  s=media.setMetadataOverride(s,target,'captureDate','');expect(media.effectiveMetadata(target,s,'captureDate').status).toBe('missing');
  s=media.setMetadataOverride(s,target,'captureDate',null);expect(media.effectiveMetadata(target,s,'captureDate').value).toBe('2026-10-03');
});
it('validates annotation kind, target and source range',()=>{
  const s=fixture();const a={id:id(9),target,kind:'note' as const,value:'x',origin:'user' as const,reviewState:'confirmed' as const};
  expect(()=>media.upsertAnnotation(s,{...a,range:{start:time(9n),duration:time(2n)}})).toThrow();
  expect(()=>media.upsertAnnotation(s,{...a,target:{kind:'asset',id:'missing'}})).toThrow();
  expect(media.removeAnnotation(media.upsertAnnotation(s,a),id(9)).annotations).toEqual([]);
});
