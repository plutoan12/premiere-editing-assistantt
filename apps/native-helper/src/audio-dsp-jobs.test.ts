import {test} from 'vitest';
import assert from 'node:assert/strict';
import {prepareAudioJob} from './audio-dsp-jobs.js';
import {AudioDspService} from './audio-dsp.js';
test('audio job validates and captures detached input before queueing',async()=>{
 const seen:unknown[]=[];const service={measure:async(x:unknown)=>{seen.push(x);return {ok:true};},normalize:async()=>({ok:true})} as unknown as AudioDspService;
 const x={path:'/original.wav',streamIndex:0,monoPolicy:'native'};const work=prepareAudioJob(service,'audio-measure',x);x.path='/changed.wav';await work(new AbortController().signal);assert.equal((seen[0] as {path:string}).path,'/original.wav');
});
test('audio jobs reject unknown command and unapproved render synchronously',()=>{
 const s=new AudioDspService();assert.throws(()=>prepareAudioJob(s,'other',{}),/job/i);
 assert.throws(()=>prepareAudioJob(s,'audio-normalize',{path:'/a.wav',streamIndex:0,monoPolicy:'native',approved:false,target:{integratedLufs:-23,truePeakDbtp:-2,loudnessRangeLu:11},allowDynamic:false}),/approval/i);
});
