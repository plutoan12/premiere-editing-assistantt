import {describe,expect,it} from "vitest";import type {AudioSampleProvider} from "@pea/sync";import {runValidation,renderMarkdown,validateManifest} from "./index.js";
function noise(n:number){let s=7;return Float32Array.from({length:n},()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296-.5})}
describe("real-media validation report",()=>{
 it("preserves signed expected offsets and reports measured error",async()=>{
  const ref=noise(512),target=new Float32Array(532);target.set(ref,20);
  const provider:AudioSampleProvider={id:"fixture",version:"1",async read(c){return{samples:c.clipId==="ref"?ref:target,sampleRate:8000,startSample:0n}}};
  const manifest={version:1 as const,sampleRate:8000,toleranceSamples:1,cases:[{id:"camera-recorder",reference:{clipId:"ref",path:"/Users/me/secret/ref.wav"},target:{clipId:"take",path:"/Users/me/secret/take.wav"},expectedOffsetSamples:"-20"}]};
  const report=await runValidation(manifest,{provider});
  expect(report.cases[0]).toMatchObject({status:"matched",expectedOffsetSamples:"-20",measuredOffsetSamples:"-20",errorSamples:"0",passed:true});
  const md=renderMarkdown(report);expect(md).toContain("camera-recorder");expect(md).not.toContain("/Users/me/secret");
 });
 it("keeps ambiguous periodic audio as review instead of a fake pass",async()=>{
  const periodic=Float32Array.from({length:512},(_,i)=>Math.sin(i*Math.PI/8)*.5);
  const provider:AudioSampleProvider={id:"fixture",version:"1",async read(){return{samples:periodic,sampleRate:8000,startSample:0n}}};
  const m={version:1 as const,sampleRate:8000,toleranceSamples:1,cases:[{id:"ambiguous",reference:{clipId:"a",path:"a.wav"},target:{clipId:"b",path:"b.wav"},expectedOffsetSamples:"0"}]};
  const r=await runValidation(m,{provider});expect(r.cases[0].status).toBe("review");expect(r.cases[0].passed).toBe(false);expect(r.cases[0].measuredOffsetSamples).toBeUndefined();
 });
 it("rejects duplicate ids and invalid tolerance",()=>{expect(()=>validateManifest({version:1,sampleRate:8000,toleranceSamples:-1,cases:[]})).toThrow();expect(()=>validateManifest({version:1,sampleRate:8000,toleranceSamples:1,cases:[{id:"x",reference:{clipId:"a",path:"a"},target:{clipId:"b",path:"b"},expectedOffsetSamples:"0"},{id:"x",reference:{clipId:"c",path:"c"},target:{clipId:"d",path:"d"},expectedOffsetSamples:"0"}]})).toThrow(/duplicate/i)});
});
