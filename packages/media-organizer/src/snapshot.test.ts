import {expect,it} from 'vitest';
import * as media from './index.js';
import {id,assetRecord,clip,time} from './testing/fixtures.js';
const fixture=():media.CatalogState=>({...media.emptyCatalog(id(100)),assets:[assetRecord()],clips:[clip()]});
it('round trips bigint times, probe results, stamps and user overrides',()=>{
  let s=fixture();s.assets[0].duration=time(9007199254740993n);s.assets[0].probe={mediaKind:'video',duration:time(9007199254740993n),candidates:[]};
  s.scans=[{scanId:id(30),uri:s.assets[0].asset.uri,state:'queued',step:'queued',stamp:{size:9007199254740993n,mtimeNs:-1n},providerVersion:'v1',settingsKey:'default'}];
  s=media.setMetadataOverride(s,{kind:'asset',id:id(1)},'deviceId','CAM_A');
  s=media.upsertAnnotation(s,{id:id(31),target:{kind:'asset',id:id(1)},kind:'note',value:'9007199254740993',range:{start:time(1n),duration:time(1n)},origin:'user',reviewState:'confirmed'});
  const json=media.exportCatalog(s),wire=JSON.parse(json);
  expect(wire.organizer.clips).toBeUndefined();expect(wire.organizer.assets[0].asset).toBeUndefined();
  expect(media.importCatalog(json)).toEqual(s);
});
it('rejects unknown versions, missing references and malformed extensions',()=>{
  const wire=JSON.parse(media.exportCatalog(fixture()));wire.schemaVersion='2.0.0';expect(()=>media.importCatalog(JSON.stringify(wire))).toThrow();
  wire.schemaVersion='1.0.0';wire.core.data.assets=[];expect(()=>media.importCatalog(JSON.stringify(wire))).toThrow();
  const malformed=JSON.parse(media.exportCatalog(fixture()));malformed.organizer.assets[0].duration.ticks='1e3';expect(()=>media.importCatalog(JSON.stringify(malformed))).toThrow();
  const orphan=JSON.parse(media.exportCatalog(fixture()));orphan.organizer.assets[0].mediaAssetId='missing';expect(()=>media.importCatalog(JSON.stringify(orphan))).toThrow();
});
it('does not modify an existing store when import fails',async()=>{
  const store=media.createMemoryCatalog(fixture());expect(()=>media.importCatalog('{broken')).toThrow();expect((await store.read()).revision).toBe(0);
});
