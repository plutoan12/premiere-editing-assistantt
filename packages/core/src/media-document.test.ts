import { expect, it } from 'vitest';
import * as core from './index.js';
const t = {ticks:9007199254740993n,timebase:{numerator:1,denominator:30000}};
const asset = {id:'a',uri:'file:///a.mov',readOnly:true as const,fingerprint:{algorithm:'sha256' as const,value:'a'.repeat(64)}};
const clip = {id:'c',mediaAssetId:'a',sourceRange:{start:{...t,ticks:0n},duration:t}};
const doc = () => ({schemaVersion:'1.0.0' as const,kind:'media' as const,data:{assets:[asset],clips:[clip]}});
it('round trips media through the existing public parser', () => {
  expect(core.parseCoreDocument(JSON.parse(JSON.stringify(core.encodeMediaDocument(doc()))))).toEqual(doc());
});
it('rejects duplicate media IDs and orphan references', () => {
  for (const data of [
    {assets:[asset,asset],clips:[clip]},
    {assets:[asset],clips:[clip,clip]},
    {assets:[asset],clips:[{...clip,mediaAssetId:'missing'}]},
  ]) expect(() => core.encodeMediaDocument({...doc(),data})).toThrow();
});
it('rejects malformed wire media and unknown document versions', () => {
  expect(() => core.parseCoreDocument({schemaVersion:'1.0.0',kind:'media',data:{assets:[asset],clips:[clip]}})).toThrow();
  expect(() => core.parseCoreDocument({...doc(),schemaVersion:'2.0.0'})).toThrow(/Unsupported schema version/);
});
