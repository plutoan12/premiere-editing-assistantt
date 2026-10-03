import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import * as cli from './index.js';
function wav(samples:Float32Array):Buffer {
  const b=Buffer.alloc(44+samples.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples.length*2,40);samples.forEach((s,i)=>b.writeInt16LE(Math.round(s*28000),44+i*2));return b;
}
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'pea-job-'));let state=99;
  const noise=Float32Array.from({length:16000},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32-.5;});
  await writeFile(join(dir,'reference.wav'),wav(noise));await writeFile(join(dir,'take.wav'),wav(noise.slice(1000)));
  const job={schemaVersion:'1.0.0',name:'Scene one',referenceClipId:'ref',files:[{clipId:'ref',path:'reference.wav'},{clipId:'take',path:'take.wav'}],
    analysis:{sampleRate:8000,windowSeconds:2},sequence:{frameRate:{rate:{numerator:24,denominator:1},dropFrame:false},width:1920,height:1080,rounding:'reject'}};
  const path=join(dir,'job.json');await writeFile(path,JSON.stringify(job));return {dir,path,job};
}
const use=async(fn:(x:Awaited<ReturnType<typeof fixture>>)=>Promise<void>)=>{const f=await fixture();try{await fn(f);}finally{await rm(f.dir,{recursive:true,force:true});}};
const hash=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
test('manifest-to-report-to-XML runs with real local files and exact placement',async()=>use(async f=>{
  const out=join(f.dir,'result');const report=await cli.runManifestFile(f.path,out);
  assert.equal(report.group.status,'matched');assert.equal(report.premiere.status,'ready-for-review');
  assert.equal(report.premiere.plan!.clips[1].startFrame,3);
  assert.ok((await readFile(join(out,'sync.xml'),'utf8')).includes('<start>3</start>'));
  const json=JSON.parse(await readFile(join(out,'sync-report.json'),'utf8'));assert.equal(json.group.members[1].offset.ticks,'1000');
  assert.equal(json.acceptance.premiereHost,'pending');assert.equal(json.acceptance.humanSyncReview,'pending');
}));
test('reference and media paths are resolved relative to manifest, not process cwd',async()=>use(async f=>{
  const report=await cli.runManifestFile(f.path,join(f.dir,'output'));
  assert.equal(report.media[0].media.path,join(f.dir,'reference.wav'));assert.ok(report.toolchain.ffmpeg.startsWith('ffmpeg version'));
}));
test('source hashes remain identical and an existing output is never overwritten',async()=>use(async f=>{
  const src=join(f.dir,'reference.wav'),before=hash(await readFile(src)),out=join(f.dir,'output');
  await cli.runManifestFile(f.path,out);assert.equal(hash(await readFile(src)),before);
  await writeFile(join(out,'keep.txt'),'keep');await assert.rejects(()=>cli.runManifestFile(f.path,out),/exist/);
  assert.equal(await readFile(join(out,'keep.txt'),'utf8'),'keep');
}));
test('unrelated/silent evidence creates a review report but no XML',async()=>use(async f=>{
  await writeFile(join(f.dir,'take.wav'),wav(new Float32Array(16000)));
  const out=join(f.dir,'review'),report=await cli.runManifestFile(f.path,out);
  assert.equal(report.group.status,'review');assert.equal(report.premiere.status,'blocked');
  assert.deepEqual((await readdir(out)).sort(),['sync-report.json']);
}));
test('unsafe or malformed manifests fail before analysis and output creation',async()=>use(async f=>{
  assert.throws(()=>cli.parseFileSyncJob({...f.job,schemaVersion:'2'}),/version/);
  assert.throws(()=>cli.parseFileSyncJob({...f.job,referenceClipId:'missing'}),/reference/);
  assert.throws(()=>cli.parseFileSyncJob({...f.job,files:[f.job.files[0],f.job.files[0]]}),/duplicate/);
  assert.throws(()=>cli.parseFileSyncJob({...f.job,files:[{clipId:'ref',path:'https://example.com/a.mov'},f.job.files[1]]}),/local/);
  assert.throws(()=>cli.parseFileSyncJob({...f.job,analysis:{sampleRate:'8000',windowSeconds:2}}),/analysis/);
}));
test('pre-cancelled jobs create no output and propagate AbortError',async()=>use(async f=>{
  const c=new AbortController();c.abort();const out=join(f.dir,'cancelled');
  await assert.rejects(()=>cli.runManifestFile(f.path,out,{signal:c.signal}),{name:'AbortError'});
  assert.ok(!(await readdir(f.dir)).includes('cancelled'));
}));
test('invalid sequence dimensions and unsupported rates fail before decoding',async()=>use(async f=>{
  assert.throws(()=>cli.parseFileSyncJob({...f.job,sequence:{...f.job.sequence,width:-1}}),/dimensions/);
  assert.throws(()=>cli.parseFileSyncJob({...f.job,sequence:{...f.job.sequence,frameRate:{rate:{numerator:27,denominator:1},dropFrame:false}}}),/unsupported/);
}));
