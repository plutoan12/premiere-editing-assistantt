import {describe,it,expect} from 'vitest';
import {runProcess} from './process-runner.js';
import {probeMedia,buildProbeArgs} from './ffmpeg.js';

describe('safe process and ffprobe',()=>{
 it('passes paths as argv after -- rather than shell text',()=>{
  expect(buildProbeArgs('/tmp/a; echo hacked.mov').slice(-2)).toEqual(['--','/tmp/a; echo hacked.mov']);
 });
 it('captures a bounded child result',async()=>{
  const r=await runProcess(process.execPath,['-e','process.stdout.write("ok")'],{timeoutMs:2000,maxStdoutBytes:32});
  expect(r.stdout.toString()).toBe('ok'); expect(r.code).toBe(0);
 });
 it('kills timed out children',async()=>{
  await expect(runProcess(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeoutMs:20,maxStdoutBytes:32})).rejects.toThrow(/timeout/i);
 });
 it('parses ffprobe JSON through an injected runner',async()=>{
  const probe=await probeMedia('/tmp/x.mov',{ffprobePath:'ffprobe',runner:async()=>({code:0,stdout:Buffer.from('{"streams":[{"codec_type":"audio","sample_rate":"48000"}],"format":{"duration":"2.5"}}'),stderr:Buffer.alloc(0)})});
  expect(probe.durationSeconds).toBe(2.5);expect(probe.audioStreams).toHaveLength(1);
 });
});
