import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncClips } from '@pea/sync';
import * as media from './index.js';

function wav(samples:Float32Array,rate=48000,channels=1):Buffer {
  const data=Buffer.alloc(44+samples.length*2);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
  data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(channels,22);data.writeUInt32LE(rate,24);
  data.writeUInt32LE(rate*channels*2,28);data.writeUInt16LE(channels*2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples.length*2,40);
  samples.forEach((x,i)=>data.writeInt16LE(Math.round(x*30000),44+i*2));return data;
}
function ff(args:string[]):void {
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin',...args],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||String(result.error));
}
async function fixtures(){
  const dir=await mkdtemp(join(tmpdir(),'pea-files-'));
  let state=41;const samples=Float32Array.from({length:48000*4},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state/2**32-.5)*.7;});
  const ref=join(dir,'기준 & reference.wav'),take=join(dir,'camera take.mov'),head=join(dir,'head.wav'),raw=join(dir,'crop.wav');
  await writeFile(ref,wav(samples));await writeFile(raw,wav(samples.slice(48000,48000*3)));
  const padded=new Float32Array(samples.length+12000);padded.set(samples,12000);await writeFile(head,wav(padded));
  ff(['-f','lavfi','-i','color=c=black:s=160x90:r=24:d=2','-i',raw,'-map','0:v:0','-map','1:a:0','-c:v','mpeg4','-c:a','pcm_s16le','-shortest',take]);
  return {dir,ref,take,head,samples};
}
const use=async(fn:(f:Awaited<ReturnType<typeof fixtures>>)=>Promise<void>)=>{const f=await fixtures();try{await fn(f);}finally{await rm(f.dir,{recursive:true,force:true});}};
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

test('subprocess runner returns bytes and fails on nonzero exit',async()=>{
  assert.equal((await media.runProcess(process.execPath,['-e','process.stdout.write("ok")'])).stdout.toString(),'ok');
  await assert.rejects(()=>media.runProcess(process.execPath,['-e','process.stderr.write("bad");process.exit(3)']),/exit 3/);
});
test('subprocess output cap and timeout terminate the child',async()=>{
  await assert.rejects(()=>media.runProcess(process.execPath,['-e','process.stdout.write("x".repeat(50000))'],{maxStdoutBytes:1000}),/limit/);
  await assert.rejects(()=>media.runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:50}),/timed out/);
});
test('abort kills a running subprocess and pre-abort never starts it',async()=>{
  const c=new AbortController();const timer=setTimeout(()=>c.abort(),50);
  try{await assert.rejects(()=>media.runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:c.signal}),{name:'AbortError'});}finally{clearTimeout(timer);}
  await assert.rejects(()=>media.runProcess('/missing-binary',[],{signal:c.signal}),{name:'AbortError'});
});
test('ffprobe reads video, audio, duration and exact frame rate from a MOV',async()=>use(async f=>{
  const m=await media.probeMedia(f.take);assert.equal(m.video?.width,160);assert.equal(m.video?.height,90);
  assert.deepEqual(m.video?.frameRate,{rate:{numerator:24,denominator:1},dropFrame:false});assert.equal(m.audio[0].sampleRate,48000);
  assert.ok(Math.abs(m.durationSeconds-2)<.001);assert.equal(m.audio[0].channels,1);
}));
test('paths with spaces, Korean and ampersands are read literally without a shell',async()=>use(async f=>{
  const m=await media.probeMedia(f.ref);assert.equal(m.audio.length,1);assert.equal(m.path,f.ref);
  await assert.rejects(()=>media.probeMedia('https://example.com/clip.wav'),/local/);
  await assert.rejects(()=>media.probeMedia(f.dir),/file/);
  const playlist=join(f.dir,'fake.m3u8');await writeFile(playlist,'#EXTM3U\nhttps://example.com/a.ts');
  await assert.rejects(()=>media.probeMedia(playlist),/format|extension/);
}));
test('decoder produces bounded Float32 mono with clip-local window origin',async()=>use(async f=>{
  const p=new media.FfmpegAudioProvider([{clipId:'r',path:f.ref,windowStartSeconds:.5}],{sampleRate:8000,windowSeconds:1});
  const w=await p.read({clipId:'r'});assert.equal(w.startSample,4000n);assert.equal(w.sampleRate,8000);assert.equal(w.samples.length,8000);
  assert.ok(w.samples.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));
  await assert.rejects(()=>p.read({clipId:'unknown'}),/unknown/);
}));
test('real MOV and WAV decode into a recovered 1-second sync offset',async()=>use(async f=>{
  const before=hash(await readFile(f.ref));const p=new media.FfmpegAudioProvider([{clipId:'r',path:f.ref},{clipId:'c',path:f.take}],{windowSeconds:4});
  const g=await syncClips('test',[{clipId:'r',hasAudio:true},{clipId:'c',hasAudio:true}],{audioProvider:p});
  assert.equal(g.status,'matched');assert.equal(g.members[1].offset.ticks,8000n);
  assert.equal(hash(await readFile(f.ref)),before);
}));
test('real audio with head silence yields a negative offset',async()=>use(async f=>{
  const p=new media.FfmpegAudioProvider([{clipId:'r',path:f.ref},{clipId:'c',path:f.head}],{windowSeconds:5});
  const g=await syncClips('test',[{clipId:'r',hasAudio:true},{clipId:'c',hasAudio:true}],{audioProvider:p});
  assert.equal(g.status,'matched');assert.equal(g.members[1].offset.ticks,-2000n);
}));
test('explicit channel selection avoids opposite-polarity stereo cancellation',async()=>use(async f=>{
  const stereo=join(f.dir,'stereo.wav');const values=new Float32Array(f.samples.length*2);f.samples.forEach((x,i)=>{values[2*i]=x;values[2*i+1]=-x;});await writeFile(stereo,wav(values,48000,2));
  const p=new media.FfmpegAudioProvider([{clipId:'r',path:stereo,channel:1}],{windowSeconds:1});
  assert.ok((await p.read({clipId:'r'})).samples.some(x=>Math.abs(x)>.01));
  const bad=new media.FfmpegAudioProvider([{clipId:'r',path:stereo,channel:5}]);await assert.rejects(()=>bad.read({clipId:'r'}),/channel/);
}));
test('audio PTS delay relative to video is retained, not silently stripped',async()=>use(async f=>{
  const delayed=join(f.dir,'delayed.mov');ff(['-f','lavfi','-i','color=c=black:s=160x90:r=24:d=5','-itsoffset','0.5','-i',f.ref,'-map','0:v:0','-map','1:a:0','-c:v','mpeg4','-c:a','pcm_s16le',delayed]);
  const p=new media.FfmpegAudioProvider([{clipId:'r',path:f.ref},{clipId:'c',path:delayed}],{windowSeconds:5});
  const g=await syncClips('test',[{clipId:'r',hasAudio:true},{clipId:'c',hasAudio:true}],{audioProvider:p});
  assert.equal(g.status,'matched');assert.equal(g.members[1].offset.ticks,-4000n);
}));
test('missing audio and invalid windows fail visibly',async()=>use(async f=>{
  const silentVideo=join(f.dir,'no-audio.mov');ff(['-f','lavfi','-i','color=s=160x90:r=24:d=1','-an','-c:v','mpeg4',silentVideo]);
  const p=new media.FfmpegAudioProvider([{clipId:'r',path:silentVideo}]);await assert.rejects(()=>p.read({clipId:'r'}),/audio/);
  assert.throws(()=>new media.FfmpegAudioProvider([{clipId:'r',path:f.ref}],{sampleRate:48000,windowSeconds:60}),/limit/);
  assert.throws(()=>new media.FfmpegAudioProvider([{clipId:'r',path:f.ref,windowStartSeconds:-1}]),/window/);
}));
test('duplicate IDs and invalid stream selectors are rejected before decode',()=>{
  assert.throws(()=>new media.FfmpegAudioProvider([{clipId:'r',path:'/x.wav'},{clipId:'r',path:'/y.wav'}]),/duplicate/);
  assert.throws(()=>new media.FfmpegAudioProvider([{clipId:'r',path:'/x.wav',audioStream:-1}]),/stream/);
});
test('AAC-compressed MP4 and 44.1 kHz WAV retain offsets through resampling',async()=>use(async f=>{
  const compressed=join(f.dir,'aac.mp4'),resampled=join(f.dir,'44100.wav');
  ff(['-i',f.take,'-c:v','copy','-c:a','aac','-b:a','160k',compressed]);ff(['-i',f.ref,'-ar','44100',resampled]);
  const p=new media.FfmpegAudioProvider([{clipId:'r',path:resampled},{clipId:'c',path:compressed}],{windowSeconds:4});
  const g=await syncClips('compressed',[{clipId:'r',hasAudio:true},{clipId:'c',hasAudio:true}],{audioProvider:p});
  assert.equal(g.status,'matched');assert.ok(Math.abs(Number(g.members[1].offset.ticks)-8000)<=1);
}));
