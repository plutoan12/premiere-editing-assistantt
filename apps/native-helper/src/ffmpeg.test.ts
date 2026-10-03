import {describe,it} from 'vitest';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runProcess} from './process-runner.js';import {probeMedia,buildProbeArgs} from './ffmpeg.js';
describe('safe process and ffprobe',()=>{
 it('passes paths as argv after -- rather than shell text',()=>{assert.deepEqual(buildProbeArgs('/tmp/a; echo hacked.mov').slice(-2),['--','/tmp/a; echo hacked.mov'])});
 it('captures a bounded child result',async()=>{const r=await runProcess(process.execPath,['-e','process.stdout.write("ok")'],{timeoutMs:2000,maxStdoutBytes:32});assert.equal(r.stdout.toString(),'ok');assert.equal(r.code,0)});
 it('kills timed out children',async()=>{await assert.rejects(runProcess(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeoutMs:20,maxStdoutBytes:32}),/timeout/i)});
 it('parses ffprobe JSON through an injected runner',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pea-probe-test-'));const path=join(dir,'fixture.mov');await writeFile(path,'fixture');
  try{const p=await probeMedia(path,{runner:async()=>({code:0,stdout:Buffer.from('{"streams":[{"codec_type":"audio","sample_rate":"48000"}],"format":{"duration":"2.5"}}'),stderr:Buffer.alloc(0)})});assert.equal(p.durationSeconds,2.5);assert.equal(p.audioStreams.length,1)}finally{await rm(dir,{recursive:true,force:true})}
 });
});
