import {expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {AudioCache,proposeNormalization,runAudioJob,sampleTime,type AudioJobRequest,type AudioSource,type LoudnessMeasurement} from '@pea/audio';
import {createFfmpegLoudnessProvider} from './audio-engine-provider.js';
import {runProcess} from './process-runner.js';

const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const request=(source:AudioSource):AudioJobRequest=>({jobId:'measure',artifactId:'measured',artifactVersion:1,attempt:0,source,operation:'loudness',settings:{}});
async function generate(path:string,args:string[]){
 const result=await runProcess('ffmpeg',['-v','error',...args,'-y',path],{timeoutMs:10000,maxStdoutBytes:0});
 expect(result.code).toBe(0);
}
async function source(path:string,channelCount:number,channelLayout:string[]):Promise<AudioSource>{
 return {media:{id:'fixture',uri:pathToFileURL(path).href,readOnly:true,fingerprint:{algorithm:'sha256',value:await hash(path)}},sampleRate:48000,channelCount,channelLayout,range:{start:sampleTime(0n,48000),duration:sampleTime(96000n,48000)}};
}

it('real stereo DSP promotes measured loudness into an Audio Engine proposal and retains previous results on mismatch',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pea-audio-bridge-'));
 try {
  const path=join(root,'source.wav');
  await generate(path,['-f','lavfi','-i','aevalsrc=0.1*sin(2*PI*1000*t)|-0.1*sin(2*PI*1000*t):s=48000:d=2','-c:a','pcm_f32le']);
  const original=await source(path,2,['FL','FR']);
  const provider=await createFfmpegLoudnessProvider({streamIndex:0,monoPolicy:'native'});
  const first=await runAudioJob(request(original),provider,{isCurrent:()=>true});
  expect(first.job.status).toBe('completed');expect(first.artifact?.source).toEqual(original);
  const measured=first.artifact!.payload as LoudnessMeasurement;
  expect(measured.integratedLufs).toBeGreaterThan(-25);expect(measured.integratedLufs).toBeLessThan(-18);
  expect(measured.truePeakDbtp).toBeCloseTo(-20,0);
  expect(proposeNormalization(measured,{integratedLufs:-23,maxTruePeakDbtp:-2,maxGainDb:12})).toMatchObject({status:'ok',targetReached:true});
  const changed=structuredClone(original);changed.media.fingerprint.value='0'.repeat(64);
  const failed=await runAudioJob({...request(changed),artifactId:'retry'},provider,{isCurrent:()=>true,previous:first.artifact});
  expect(failed.code).toBe('PROVIDER_FAILED');expect(failed.artifact).toBe(first.artifact);
  const trimmed=structuredClone(original);trimmed.range.duration=sampleTime(48000n,48000);
  expect((await runAudioJob(request(trimmed),provider,{isCurrent:()=>true})).job.status).toBe('failed');
  expect(await hash(path)).toBe(original.media.fingerprint.value);
 } finally {await rm(root,{recursive:true,force:true});}
},20000);

it('real multi-stream media measures the selected stream and never reuses another stream cache',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pea-audio-streams-'));
 try {
  const path=join(root,'streams.mov');
  await generate(path,['-f','lavfi','-i','anullsrc=r=48000:cl=mono:d=2','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=2','-map','0:a','-map','1:a','-c:a','pcm_s16le']);
  const media=await source(path,1,['FC']),cache=new AudioCache();
  const silent=await createFfmpegLoudnessProvider({streamIndex:0,monoPolicy:'native'});
  const tone=await createFfmpegLoudnessProvider({streamIndex:1,monoPolicy:'native'});
  const options={cache,isCurrent:()=>true};
  const a=await runAudioJob(request(media),silent,options),b=await runAudioJob(request(media),tone,options);
  expect(a.job.status).toBe('completed');expect(a.artifact?.payload).toEqual({integratedLufs:null,truePeakDbtp:null});
  expect(b.job.status).toBe('completed');expect(b.cacheHit).toBe(false);
  expect((b.artifact?.payload as LoudnessMeasurement).integratedLufs).toBeTypeOf('number');
  expect((await runAudioJob(request(media),tone,options)).cacheHit).toBe(true);
  expect(await hash(path)).toBe(media.media.fingerprint.value);
 } finally {await rm(root,{recursive:true,force:true});}
},20000);
