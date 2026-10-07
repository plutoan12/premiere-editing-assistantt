import {expect,it} from 'vitest';
import * as media from './index.js';
import {id,assetRecord} from './testing/fixtures.js';
const target={kind:'asset' as const,id:id(1)};
const fixture=()=>({...media.emptyCatalog(id(100)),assets:[assetRecord()]});
it('does not infer capture date from mtime or camera identity from a model',()=>{
  const r=media.classify(target,fixture(),media.defaultRuleSet(id(50)));
  expect(r.pathSegments).toEqual(['Media Organizer','촬영일 미확인','기기 미확인','Other']);expect(r.requiresReview).toBe(true);
});
it('uses confirmed dates and devices and supports rule reordering',()=>{
  let s=media.setMetadataOverride(fixture(),target,'captureDate','2026-10-03');
  s=media.setMetadataOverride(s,target,'deviceId','CAM_A');s=media.setMetadataOverride(s,target,'mediaKind','video');
  const rules=media.defaultRuleSet(id(50));expect(media.classify(target,s,rules).pathSegments).toEqual(['Media Organizer','2026-10-03','CAM_A','Video']);
  rules.orderedFields=['deviceId','captureDate'];expect(media.classify(target,s,rules).pathSegments).toEqual(['Media Organizer','CAM_A','2026-10-03']);
});
it('matches folder boundaries and reports conflicting mappings',()=>{
  const rules=media.defaultRuleSet(id(50));rules.orderedFields=['deviceId'];rules.pathMappings=[{prefix:'file:///shoot/A',deviceId:'wrong'}];
  expect(media.classify(target,fixture(),rules).requiresReview).toBe(true);
  rules.pathMappings=[{prefix:'file:///shoot',deviceId:'A'},{prefix:'file:///shoot',deviceId:'B'}];
  expect(media.classify(target,fixture(),rules).status).toBe('conflict');
});
it('extracts scene and take only from explicit bounded patterns',()=>{
  const s=fixture();s.assets=[assetRecord(1,'file:///SC12_TK03.mov')];
  const rules=media.defaultRuleSet(id(50));rules.filenameRules=[{pattern:'SC{digits}_TK{digits}',field:'scene',group:1},{pattern:'SC{digits}_TK{digits}',field:'take',group:2}];
  expect(media.ruleCandidates(target,s,rules).map(x=>[x.field,x.value])).toEqual([['scene','12'],['take','03']]);
  expect(media.ruleCandidates(target,s,media.defaultRuleSet(id(51)))).toEqual([]);
});
it('rejects unsupported patterns and impossible dates',()=>{
  const rules=media.defaultRuleSet(id(50));rules.filenameRules=[{pattern:'{anything}',field:'scene',group:1}];
  expect(()=>media.ruleCandidates(target,fixture(),rules)).toThrow(/pattern/);
  rules.filenameRules=[{pattern:'{date}',field:'captureDate',group:1}];const s=fixture();s.assets=[assetRecord(1,'file:///2026-02-30.mov')];
  expect(media.ruleCandidates(target,s,rules)).toEqual([]);
});
