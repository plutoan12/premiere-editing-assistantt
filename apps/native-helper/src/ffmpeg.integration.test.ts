import {describe,it,beforeAll,afterAll} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {runProcess} from './process-runner.js';import {probeMedia} from './ffmpeg.js';
import {FfmpegAudioSampleProvider} from './audio-provider.js';import {correlateAudio} from '@pea/sync';
import {noise,writeWave} from './fixture-utils.js';
import {createHelperServer} from './server.js';
const run=(args:string[])=>runProcess('ffmpeg',args,{timeoutMs:10000,maxStdoutBytes:65536});
let dir:string,master:string,take:string,video:string;
const offset=1487;
describe('required real FFmpeg end-to-end',()=>{
 beforeAll(async()=>{
  for(const tool of ['ffmpeg','ffprobe']){
   const r=await runProcess(tool,['-version'],{timeoutMs:3000,maxStdoutBytes:65536});assert.equal(r.code,0,`${tool} must be installed; no skip`);
  }
  dir=await mkdtemp(join(tmpdir(),'pea-media-e2e-'));master=join(dir,'기준 audio.wav');take=join(dir,'take ; literal.wav');video=join(dir,'camera.mov');
  const samples=noise(24000);await writeWave(master,samples);await writeWave(take,samples.slice(offset));
  const generated=await run(['-v','error','-f','lavfi','-i','color=c=black:s=32x32:r=25','-i',take,'-map','0:v:0','-map','1:a:0','-c:v','mpeg4','-c:a','pcm_s16le','-shortest','-y',video]);assert.equal(generated.code,0,generated.stderr.toString());
 });
 afterAll(async()=>{if(dir)await rm(dir,{recursive:true,force:true})});
 const provider=(path:string,rate=8000)=>new FfmpegAudioSampleProvider({resolvePath:()=>path,sampleRate:rate});
 it('probes a generated video container and decodes its audio',async()=>{
  const p=await probeMedia(video);assert.equal(p.audioStreams.length,1);assert.equal(p.videoStreams.length,1);
  const w=await provider(video).readWindow({clipId:'camera'},{startSample:0n,maxSamples:8000});assert.equal(w.samples.length,8000);
 });
 it('recovers known positive and negative video/audio offsets within one sample',async()=>{
  const a=await provider(master).readWindow({clipId:'master'},{startSample:0n,maxSamples:16000});
  const b=await provider(video).readWindow({clipId:'camera'},{startSample:0n,maxSamples:14000});
  for(const [x,y,expected] of [[a,b,offset],[b,a,-offset]] as const){
   const r=correlateAudio(x,y,{maxLagSamples:4000,minOverlapSamples:8000});assert.equal(r.status,'matched');assert.ok(Math.abs(r.offsetSamples!-expected)<=1);console.log(JSON.stringify({check:'known-offset',expectedSamples:expected,measuredSamples:r.offsetSamples}));
  }
 });
 it('preserves different analysis window origins when calculating clip placement',async()=>{
  const a=await provider(master).readWindow({clipId:'master'},{startSample:500n,maxSamples:16000});
  const b=await provider(video).readWindow({clipId:'camera'},{startSample:200n,maxSamples:14000});
  const r=correlateAudio(a,b,{maxLagSamples:4000,minOverlapSamples:8000});assert.equal(r.status,'matched');assert.equal(BigInt(r.offsetSamples!)+a.startSample-b.startSample,BigInt(offset));
 });
 it('uses exact sample-count windows after resampling rather than resetting the filter at a seek',async()=>{
  const path=join(dir,'48k.wav');await writeWave(path,noise(48000),48000);
  const p=provider(path);const all=await p.readWindow({clipId:'a'},{startSample:0n,maxSamples:7000});const part=await p.readWindow({clipId:'a'},{startSample:101n,maxSamples:3000});
  assert.equal(part.samples.length,3000);assert.equal(part.startSample,101n);
  for(let i=0;i<part.samples.length;i++)assert.ok(Math.abs(part.samples[i]-all.samples[101+i])<1e-6,`resampling mismatch at ${i}`);
 });
 it('reports no-audio and corrupt media as errors',async()=>{
  const noAudio=join(dir,'silent-video.mov');const bad=join(dir,'corrupt.mov');await writeFile(bad,'not a video');
  assert.equal((await run(['-v','error','-f','lavfi','-i','color=s=32x32:r=25:d=0.2','-an','-c:v','mpeg4','-y',noAudio])).code,0);
  await assert.rejects(provider(noAudio).readWindow({clipId:'a'},{startSample:0n,maxSamples:100}),/audio/i);
  await assert.rejects(provider(bad).readWindow({clipId:'a'},{startSample:0n,maxSamples:100}));
 });
 it('does not modify any input file',async()=>{
  const before=createHash('sha256').update(await readFile(video)).digest('hex');await provider(video).readWindow({clipId:'camera'},{startSample:1n,maxSamples:50});assert.equal(createHash('sha256').update(await readFile(video)).digest('hex'),before);
 });
 it('runs authenticated HTTP audio jobs through real FFmpeg and then the Sync algorithm',async()=>{
  const h=await createHelperServer({host:'127.0.0.1',port:0});
  const headers={authorization:`Bearer ${h.sessionToken}`,'content-type':'application/json'};
  async function windowViaJob(path:string,maxSamples:number){
   const response=await fetch(h.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind:'audio-window',input:{path,startSample:'0',maxSamples}})});
   assert.equal(response.status,202);const {id}=await response.json();let record;
   for(let i=0;i<200;i++){record=await (await fetch(`${h.address}/v1/jobs/${id}`,{headers})).json();if(record.status==='completed'||record.status==='failed')break;await new Promise(r=>setTimeout(r,5))}
   assert.equal(record.status,'completed',JSON.stringify(record));
   const binary=await fetch(h.address+record.result.audioUrl,{headers});assert.equal(binary.status,200);
   const bytes=Buffer.from(await binary.arrayBuffer());const samples=Float32Array.from({length:bytes.length/4},(_,i)=>bytes.readFloatLE(i*4));
   await fetch(`${h.address}/v1/jobs/${id}`,{method:'DELETE',headers});
   return {samples,sampleRate:Number(binary.headers.get('x-pea-sample-rate')),startSample:BigInt(binary.headers.get('x-pea-start-sample')!)};
  }
  try{const a=await windowViaJob(master,16000),b=await windowViaJob(video,14000);const result=correlateAudio(a,b,{maxLagSamples:4000,minOverlapSamples:8000});assert.equal(result.status,'matched');assert.equal(result.offsetSamples,offset);console.log(JSON.stringify({check:'http-job-ffmpeg-sync',expectedSamples:offset,measuredSamples:result.offsetSamples}))}finally{await h.close()}
 });

});
