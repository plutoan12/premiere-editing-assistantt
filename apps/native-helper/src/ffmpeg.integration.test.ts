import {describe,it,expect} from 'vitest';
import {access,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runProcess} from './process-runner.js';import {probeMedia} from './ffmpeg.js';import {FfmpegAudioSampleProvider} from './audio-provider.js';
async function available(name:string){try{await runProcess(name,['-version'],{timeoutMs:3000,maxStdoutBytes:65536});return true}catch{return false}}
describe('system FFmpeg integration',()=>{
 it.skipIf(!(await available('ffmpeg'))||!(await available('ffprobe')))('generates probes and decodes tiny real container media',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pea-ffmpeg-'));const file=join(dir,'tone.wav');
  try{
   const gen=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=8000:duration=0.2','-y',file],{timeoutMs:10000,maxStdoutBytes:1024});
   expect(gen.code).toBe(0);const meta=await probeMedia(file);expect(meta.audioStreams.length).toBeGreaterThan(0);
   const p=new FfmpegAudioSampleProvider({resolvePath:()=>file,ffmpegPath:'ffmpeg',sampleRate:8000});
   const w=await p.readWindow({clipId:'tone'},{startSample:0n,maxSamples:400});expect(w.samples.length).toBeGreaterThan(0);expect(w.samples.length).toBeLessThanOrEqual(400);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
});
