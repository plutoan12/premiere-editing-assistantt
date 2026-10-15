import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runProcess } from './process.js';
import * as api from './media.js';
import { withMedia,writeWave,noise,ffmpeg,ffprobe } from './test-fixtures.js';
const window={sampleRate:8000,startSample:'0',sampleCount:1024};
const command={timeoutMs:10000,maxOutputBytes:1024};
async function service(root:string){assert.equal(typeof api.MediaService,'function');return api.MediaService.create({roots:[root],ffmpeg,ffprobe});}
describe('real FFmpeg decoding with generated media',()=>{
 it('probes and decodes an exact bounded WAV window without changing the file',async()=>withMedia(async root=>{
  const path=join(root,'테스트.wav'),x=noise(8000);await writeWave(path,x);const original=await readFile(path);const s=await service(root);const a=await s.register(path);assert.equal(a.audio[0].sampleRate,8000);
  const r=await s.read(a.assetId,{...window,startSample:'137'});assert.equal(r.window.startSample,137n);assert.equal(r.window.samples.length,1024);
  for(let i=0;i<1024;i++)assert.ok(Math.abs(r.window.samples[i]-x[137+i])<.00005);
  assert.equal(r.sha256,createHash('sha256').update(r.pcm).digest('hex'));assert.deepEqual(await readFile(path),original);
 }));
 it('extracts audio from a real MOV container',async()=>withMedia(async root=>{
  await writeWave(join(root,'a.wav'),noise(8000));const mov=join(root,'a.mov');
  await runProcess(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','color=black:s=32x32:r=24:d=1','-i',join(root,'a.wav'),'-c:v','mpeg4','-c:a','pcm_s16le','-shortest',mov],command);
  const s=await service(root),a=await s.register(mov);assert.equal(a.video.length,1);const r=await s.read(a.assetId,window);assert.equal(r.window.samples.length,1024);
 }));
 it('selects one stereo channel explicitly',async()=>withMedia(async root=>{
  const stereo=Float32Array.from({length:8000},(_,i)=>i%2?.3:-.2);await writeWave(join(root,'stereo.wav'),stereo,8000,2);const s=await service(root),a=await s.register(join(root,'stereo.wav'));
  const r=await s.read(a.assetId,{...window,channel:1});assert.ok(r.window.samples.every(x=>Math.abs(x-.3)<.0001));
 }));
 it('resamples with explicit rate and requested output length',async()=>withMedia(async root=>{
  await writeWave(join(root,'a.wav'),noise(48000),48000);const s=await service(root),a=await s.register(join(root,'a.wav'));const r=await s.read(a.assetId,{...window,sampleRate:16000});assert.equal(r.window.sampleRate,16000);assert.equal(r.window.samples.length,1024);
 }));
 it('stops after the requested output window instead of draining the entire recording',async()=>withMedia(async root=>{
  const path=join(root,'long.wav');await writeWave(path,noise(80000));
  // Pace real FFmpeg input at real time so a short-window completion proves early stop.
  const wrapper=join(root,'paced-ffmpeg');
  const quoted="'"+ffmpeg.replaceAll("'", "'\"'\"'")+"'";
  await writeFile(wrapper,'#!/bin/sh\nexec '+quoted+' -readrate 1 "$@"\n',{mode:0o700});
  const s=await api.MediaService.create({roots:[root],ffmpeg:wrapper,ffprobe,timeoutMs:3000});
  const a=await s.register(path);const r=await s.read(a.assetId,window);assert.equal(r.window.samples.length,1024);
 }));
 it('rejects media without audio',async()=>withMedia(async root=>{
  const path=join(root,'silent.mov');await runProcess(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','color=black:s=32x32:r=24:d=1','-an','-c:v','mpeg4',path],command);
  const s=await service(root),a=await s.register(path);await assert.rejects(s.read(a.assetId,window),{code:'NO_AUDIO'});
 }));
 it('rejects corrupt media without exposing stderr or paths',async()=>withMedia(async root=>{
  const path=join(root,'private-name.mov');await writeFile(path,'not a media file');const s=await service(root);await assert.rejects(s.register(path),(error:Error)=>!error.message.includes(path)&&!error.message.includes('private-name'));
 }));
 it('rejects an asset changed since probing',async()=>withMedia(async root=>{
  const path=join(root,'a.wav');await writeWave(path,noise(8000));const s=await service(root),a=await s.register(path);await writeWave(path,noise(16000));await assert.rejects(s.read(a.assetId,window),{code:'MEDIA_CHANGED'});
 }));
 it('rejects invalid windows and unknown streams before decode',async()=>withMedia(async root=>{
  const path=join(root,'a.wav');await writeWave(path,noise(8000));const s=await service(root),a=await s.register(path);
  for(const bad of [{sampleCount:262145},{startSample:'-1'},{startSample:'1.5'},{sampleRate:0},{channel:50},{stream:40}])await assert.rejects(s.read(a.assetId,{...window,...bad}));
 }));
 it('rejects a window beyond EOF instead of padding/faking samples',async()=>withMedia(async root=>{
  const path=join(root,'a.wav');await writeWave(path,noise(8000));const s=await service(root),a=await s.register(path);await assert.rejects(s.read(a.assetId,{...window,startSample:'7900'}),{code:'SHORT_WINDOW'});
 }));
 it('keeps pre-cancellation explicit',async()=>withMedia(async root=>{
  const path=join(root,'a.wav');await writeWave(path,noise(8000));const s=await service(root),a=await s.register(path);await assert.rejects(s.read(a.assetId,window,AbortSignal.abort()),{name:'AbortError'});
 }));
});
describe('unsupported timeline and indirect input safety',()=>{
 it('rejects an audio/video stream-start mismatch',async()=>withMedia(async root=>{
  await writeWave(join(root,'a.wav'),noise(8000));const mov=join(root,'offset.mov');
  await runProcess(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','color=black:s=32x32:r=24:d=2','-itsoffset','0.25','-i',join(root,'a.wav'),'-c:v','mpeg4','-c:a','pcm_s16le',mov],command);
  const s=await service(root),a=await s.register(mov);assert.ok(a.audio[0].startSeconds!>0);await assert.rejects(s.read(a.assetId,window),{code:'UNSUPPORTED_TIMELINE'});
 }));
 it('rejects a playlist rather than following referenced URLs/files',async()=>withMedia(async root=>{
  const path=join(root,'indirect.m3u8');await writeFile(path,'#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttps://example.com/private.ts\n#EXT-X-ENDLIST\n');
  const s=await service(root);await assert.rejects(s.register(path),{code:'PROCESS_FAILED'});
 }));
});
