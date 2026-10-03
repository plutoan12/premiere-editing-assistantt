import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {FfmpegAudioSampleProvider,buildAudioArgs} from './audio-provider.js';

describe('FFmpeg audio provider',()=>{
 it('builds bounded mono f32le decode argv without a shell',()=>{
  const args=buildAudioArgs('/tmp/a b.mov',8000,16000n,4000);
  assert.equal(args[args.indexOf('-ac')+1],'1');assert.ok(args.includes('f32le'));assert.equal(args.at(-1),'pipe:1');assert.ok(args.includes('/tmp/a b.mov'));
 });
 it('decodes copied normalized samples with exact startSample',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pea-provider-test-'));const path=join(dir,'fixture.wav');await writeFile(path,'fixture');
  try{const pcm=Buffer.alloc(12);[.1,-.2,.3].forEach((v,i)=>pcm.writeFloatLE(v,i*4));
   const runner=async(exe:string)=>({code:0,stdout:exe.includes('ffprobe')?Buffer.from('{"streams":[{"codec_type":"audio","sample_rate":"8000"}]}'):pcm,stderr:Buffer.alloc(0)});
   const p=new FfmpegAudioSampleProvider({resolvePath:()=>path,runner,sampleRate:8000});
   const w=await p.readWindow({clipId:'a'},{startSample:25n,maxSamples:3});assert.equal(w.startSample,25n);assert.equal(w.samples.length,3);assert.ok(Math.abs(w.samples[0]-.1)<1e-6);pcm.fill(0);assert.ok(Math.abs(w.samples[0]-.1)<1e-6);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
 it('rejects requests beyond the sync analysis bound before spawning',async()=>{
  let called=false;const p=new FfmpegAudioSampleProvider({resolvePath:()=>'/tmp/x.mov',runner:async()=>{called=true;throw new Error('unexpected spawn')}});
  await assert.rejects(p.readWindow({clipId:'a'},{startSample:0n,maxSamples:262145}),/sample/i);assert.equal(called,false);
 });
});
