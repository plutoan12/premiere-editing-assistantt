import {expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AudioDspService} from './audio-dsp.js';
import type {runProcess} from './process-runner.js';

it('normalizes CRLF runtime provenance consistently with the Audio Engine provider',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pea-version-test-'));
 try {
  const path=join(root,'source.wav');await writeFile(path,'fixture');
  const runner:typeof runProcess=async(_exe,args)=>({code:0,
   stdout:Buffer.from(args.includes('-version')?'ffmpeg version fixture\r\nconfiguration: fixture\r\n':args.includes('-show_streams')?JSON.stringify({format:{duration:'2',start_time:'0'},streams:[{index:0,codec_type:'audio',sample_rate:'48000',channels:1,channel_layout:'mono',duration:'2',start_time:'0'}]}):''),
   stderr:Buffer.from(args.includes('-af')?'Summary:\nIntegrated loudness:\n I: -23.0 LUFS\nLoudness range:\n LRA: 1.0 LU\nTrue peak:\n Peak: -20.0 dBFS\nNumber of samples: 96000\n':''),
  });
  const measured=await new AudioDspService({runner}).measure({path,streamIndex:0,monoPolicy:'native'});
  expect(measured.ffmpegVersion).toBe('ffmpeg version fixture');
 } finally {await rm(root,{recursive:true,force:true});}
});
