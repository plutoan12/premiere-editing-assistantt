import {describe,it,expect} from 'vitest';
import {FfmpegAudioSampleProvider,buildAudioArgs} from './audio-provider.js';
import type {ProcessResult,RunOptions} from './process-runner.js';

describe('FFmpeg audio provider',()=>{
 it('builds bounded mono f32le decode argv without a shell',()=>{
  const args=buildAudioArgs('/tmp/a b.mov',8000,16000n,4000);
  expect(args).toContain('-ac'); expect(args[args.indexOf('-ac')+1]).toBe('1'); expect(args).toContain('f32le'); expect(args.slice(-2)).toEqual(['pipe:1']);
  expect(args.join(' ')).toContain('/tmp/a b.mov');
 });
 it('decodes copied normalized samples with exact startSample',async()=>{
  const pcm=Buffer.alloc(4*3);[.1,-.2,.3].forEach((v,i)=>pcm.writeFloatLE(v,i*4));
  const runner=async(_e:string,_a:readonly string[],_o:RunOptions):Promise<ProcessResult>=>({code:0,stdout:pcm,stderr:Buffer.alloc(0)});
  const p=new FfmpegAudioSampleProvider({resolvePath:()=>'/tmp/x.mov',runner,ffmpegPath:'ffmpeg',sampleRate:8000});
  const w=await p.readWindow({clipId:'a'}, {startSample:25n,maxSamples:3});
  expect(w.startSample).toBe(25n);expect([...w.samples]).toHaveLength(3);expect(w.samples[0]).toBeCloseTo(.1);
 });
 it('rejects requests beyond the sync analysis bound before spawning',async()=>{
  let called=false;const runner=async()=>{called=true;throw new Error('should not spawn')};
  const p=new FfmpegAudioSampleProvider({resolvePath:()=>'/tmp/x.mov',runner:runner as any,ffmpegPath:'ffmpeg',sampleRate:8000});
  await expect(p.readWindow({clipId:'a'}, {startSample:0n,maxSamples:262145})).rejects.toThrow(/sample/i);expect(called).toBe(false);
 });
});
