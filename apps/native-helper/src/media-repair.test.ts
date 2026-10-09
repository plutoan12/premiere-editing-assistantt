import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {buildAudioArgs,FfmpegAudioSampleProvider} from './audio-provider.js';
import {probeMedia,buildProbeArgs} from './ffmpeg.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const result=(stdout=Buffer.alloc(4))=>({code:0,stdout,stderr:Buffer.alloc(0)});
describe('bounded local media boundary',()=>{
 it('does not enable remote input protocols or playlist demuxers',()=>{
  for(const args of [buildProbeArgs('/tmp/a; echo b.mov'),buildAudioArgs('/tmp/a; echo b.mov',8000,25n,3)]){
   assert.equal(args[args.indexOf('-protocol_whitelist')+1],'file,pipe');
   assert.ok(args.includes('-format_whitelist'));
   assert.equal(args.filter(s=>s==='/tmp/a; echo b.mov').length,1);
  }
 });
 it('validates sample rate and huge sample origins before running a child',async()=>{
  let calls=0;const runner=async()=>{calls++;return result()};
  for(const sampleRate of [0,8000.5,NaN,384001]){
   const p=new FfmpegAudioSampleProvider({resolvePath:()=>'/tmp/fake.wav',sampleRate,runner});
   await assert.rejects(p.readWindow({clipId:'a'},{startSample:0n,maxSamples:1}),/sample rate/i);
  }
  const p=new FfmpegAudioSampleProvider({resolvePath:()=>'/tmp/fake.wav',runner});
  await assert.rejects(p.readWindow({clipId:'a'},{startSample:9007199254740993n,maxSamples:1}),/start sample/i);assert.equal(calls,0);
 });
 it('rejects URL and non-file inputs before the runner',async()=>{
  let calls=0;const runner=async()=>{calls++;return result()};
  for(const path of ['http://127.0.0.1/admin','file:/etc/passwd','../relative','/dev/zero']){
   await assert.rejects(probeMedia(path,{runner}),/local|regular|absolute/i);
  }assert.equal(calls,0);
 });
 it('rejects malformed ffprobe structures rather than inventing metadata',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pea-probe-test-'));const path=join(dir,'source.wav');await writeFile(path,'fixture');
  try{for(const body of ['null','{}','{"streams":"oops"}','{']){
   await assert.rejects(probeMedia(path,{runner:async()=>result(Buffer.from(body))}),/ffprobe|metadata/i);
  }}finally{await rm(dir,{recursive:true,force:true})}
 });
 it('does not return empty successful PCM windows',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pea-empty-test-'));const path=join(dir,'source.wav');await writeFile(path,'fixture');
  const runner=async(exe:string)=>exe.includes('ffprobe')?result(Buffer.from('{"streams":[{"codec_type":"audio"}]}')):result(Buffer.alloc(0));
  try{const p=new FfmpegAudioSampleProvider({resolvePath:()=>path,runner});await assert.rejects(p.readWindow({clipId:'a'},{startSample:0n,maxSamples:20}),/empty|audio/i)}finally{await rm(dir,{recursive:true,force:true})}
 });
});
