import {test} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runProcess} from './process-runner.js';
import {AudioDspService} from './audio-dsp.js';
const ffmpeg=process.env.PEA_FFMPEG_PATH??'ffmpeg';
async function fixture(fn:(root:string,path:string)=>Promise<void>,expr='aevalsrc=0.1*sin(2*PI*1000*t)|-0.1*sin(2*PI*1000*t):s=48000:d=4'){
 const root=await mkdtemp(join(tmpdir(),'pea-dsp-test-'));const path=join(root,'source.wav');
 try{const r=await runProcess(ffmpeg,['-hide_banner','-nostats','-v','error','-f','lavfi','-i',expr,'-c:a','pcm_f32le','-y',path],{timeoutMs:10000,maxStdoutBytes:0});assert.equal(r.code,0);await fn(root,path);}finally{await rm(root,{recursive:true,force:true});}
}
const input=(path:string)=>({path,streamIndex:0,monoPolicy:'native' as const});
const target={integratedLufs:-23,truePeakDbtp:-2,loudnessRangeLu:11};
const normalize=(path:string)=>({...input(path),approved:true as const,target,allowDynamic:false});
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
test('real FFmpeg retains opposite-phase stereo and original rate/count',async()=>fixture(async(root,path)=>{const m=await new AudioDspService().measure(input(path));assert.equal(m.channels,2);assert.equal(m.sampleRate,48000);assert.equal(m.sampleCount,192000);assert.equal(m.channelLayout,'stereo');assert.equal(m.status,'measured');assert.ok(m.integratedLufs!>-25&&m.integratedLufs!<-18);assert.equal(m.sourceSha256,hash(await readFile(path)));assert.match(m.ffmpegVersion,/ffmpeg version/);assert.equal((await readdir(root)).length,1);}));
test('real silence is measured as unmeasurable and cannot normalize',async()=>fixture(async(root,path)=>{const s=new AudioDspService({outputRoot:root});assert.equal((await s.measure(input(path))).status,'unmeasurable');await assert.rejects(s.normalize(normalize(path)),/measur/i);assert.deepEqual(await readdir(root),['source.wav']);},'anullsrc=r=48000:cl=stereo:d=1'));
test('mono dual-mono policy changes loudness not sample count',async()=>fixture(async(_root,path)=>{const s=new AudioDspService();const a=await s.measure(input(path)),b=await s.measure({...input(path),monoPolicy:'dual-mono'});assert.ok(Math.abs(b.integratedLufs!-a.integratedLufs!-3.0)<0.2);assert.equal(a.sampleCount,b.sampleCount);},'sine=frequency=1000:sample_rate=44100:duration=2'));
test('two pass normalization remeasures and never overwrites source or previous output',async()=>fixture(async(root,path)=>{const before=hash(await readFile(path));const s=new AudioDspService({outputRoot:root});const a=await s.normalize(normalize(path));assert.equal(a.normalizationMode,'linear');assert.equal(a.status,a.warnings.length?'review-required':'ready-for-review');assert.equal(a.before.sampleCount,a.after.sampleCount);assert.equal(a.after.channels,2);assert.equal(a.after.sampleRate,48000);if(Math.abs(a.after.integratedLufs!-target.integratedLufs)>0.5)assert.ok(a.warnings.includes('INTEGRATED_TARGET_NOT_MET'));else assert.ok(!a.warnings.includes('INTEGRATED_TARGET_NOT_MET'));assert.ok(a.after.truePeakDbtp!<=target.truePeakDbtp);assert.equal(before,hash(await readFile(path)));const saved=hash(await readFile(a.outputPath));const b=await s.normalize(normalize(path));assert.notEqual(a.outputPath,b.outputPath);assert.equal(saved,hash(await readFile(a.outputPath)));assert.equal((await stat(a.outputPath)).mode&0o777,0o600);assert.equal(JSON.parse(await readFile(a.reportPath,'utf8')).humanReview,'pending');},'aevalsrc=(0.05+0.03*sin(2*PI*t/6))*sin(2*PI*1000*t)|-(0.05+0.03*sin(2*PI*t/6))*sin(2*PI*1000*t):s=48000:d=12'));
test('pre-cancel never creates output',async()=>fixture(async(root,path)=>{const c=new AbortController();c.abort();await assert.rejects(new AudioDspService({outputRoot:root}).normalize(normalize(path),c.signal),{name:'AbortError'});assert.deepEqual(await readdir(root),['source.wav']);}));
test('render requires trusted output root; missing stream fails',async()=>fixture(async(_root,path)=>{await assert.rejects(new AudioDspService().normalize(normalize(path)),/output/i);await assert.rejects(new AudioDspService().measure({...input(path),streamIndex:17}),/stream/i);}));
test('output size budget rejects before writing a partial render',async()=>fixture(async(root,path)=>{await assert.rejects(new AudioDspService({outputRoot:root,maxOutputBytes:65536}).normalize(normalize(path)),/limit|budget/i);assert.deepEqual(await readdir(root),['source.wav']);}));
test('corrupt and remote input fail without source leakage',async()=>fixture(async(_root,path)=>{await writeFile(path,'not audio');await assert.rejects(new AudioDspService().measure(input(path)),/media|probe/i);await assert.rejects(new AudioDspService().measure(input('https://example.invalid/x.wav')),/local/i);}));

test('zero LRA does not silently permit dynamic rendering',async()=>fixture(async(root,path)=>{const s=new AudioDspService({outputRoot:root});await assert.rejects(s.normalize(normalize(path)),/dynamic/i);assert.deepEqual(await readdir(root),['source.wav']);const r=await s.normalize({...normalize(path),allowDynamic:true});assert.equal(r.normalizationMode,'dynamic');assert.equal(r.status,'ready-for-review');assert.ok(Math.abs(r.after.integratedLufs!-target.integratedLufs)<=0.5);assert.equal(r.before.sampleCount,r.after.sampleCount);assert.equal(r.humanReview,'pending');}));

test('cancellation during actual render waits for process close and cleans only new work',async()=>fixture(async(root,path)=>{
 const c=new AbortController();await writeFile(join(root,'keep.txt'),'prior');let closed=false;
 const runner:typeof runProcess=async(exe,args,opts)=>{
  if(args.includes('pcm_f32le')){const timer=setTimeout(()=>c.abort(),30);try{return await runProcess(process.execPath,['-e','setTimeout(()=>{},60000)'],opts);}finally{clearTimeout(timer);closed=true;}}
  return runProcess(exe,args,opts);
 };
 await assert.rejects(new AudioDspService({outputRoot:root,runner}).normalize({...normalize(path),allowDynamic:true},c.signal),{name:'AbortError'});
 assert.equal(closed,true);assert.deepEqual((await readdir(root)).sort(),['keep.txt','source.wav']);
}));
test('failed renderer removes private working directory without deleting prior artifacts',async()=>fixture(async(root,path)=>{
 await writeFile(join(root,'keep.txt'),'prior');const runner:typeof runProcess=async(exe,args,opts)=>args.includes('pcm_f32le')?{code:1,stdout:Buffer.alloc(0),stderr:Buffer.from('private path must not leak')}:runProcess(exe,args,opts);
 await assert.rejects(new AudioDspService({outputRoot:root,runner}).normalize({...normalize(path),allowDynamic:true}),e=>e instanceof Error&&e.message==='Media probe or audio DSP processing failed');assert.deepEqual((await readdir(root)).sort(),['keep.txt','source.wav']);
}));
test('input mutation during measurement is rejected',async()=>fixture(async(_root,path)=>{
 const runner:typeof runProcess=async(exe,args,opts)=>{const r=await runProcess(exe,args,opts);if(args.some(a=>a.startsWith('ebur128=')))await writeFile(path,Buffer.concat([await readFile(path),Buffer.from('changed')]));return r;};
 await assert.rejects(new AudioDspService({runner}).measure(input(path)),/source changed/i);
}));
test('total operation deadline aborts a running child',async()=>fixture(async(_root,path)=>{
 const runner:typeof runProcess=(_exe,_args,opts)=>runProcess(process.execPath,['-e','setTimeout(()=>{},60000)'],opts);
 await assert.rejects(new AudioDspService({runner,timeoutMs:50}).measure(input(path)),/timeout|timed out/i);
}));
test('5.1 measurement retains six channels with explicit layout',async()=>fixture(async(_root,path)=>{const m=await new AudioDspService().measure(input(path));assert.equal(m.channels,6);assert.equal(m.channelLayout,'5.1');assert.equal(m.sampleCount,96000);},'aevalsrc=0.02*sin(2*PI*1000*t)|0|0|0|0|0:s=48000:d=2:c=5.1'));
