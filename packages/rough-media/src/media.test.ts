import { test } from "vitest";
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {createFFmpegMediaProvider,parseProbe,decodePcm} from './index.js';
const meta={streams:[{codec_type:'video',width:160,height:90,r_frame_rate:'24/1',avg_frame_rate:'24/1',time_base:'1/12288',start_time:'0',duration:'5',sample_aspect_ratio:'1:1',field_order:'progressive'},{codec_type:'audio',channels:2,sample_rate:'48000',start_time:'0',duration:'5'}],format:{duration:'5'}};
const frames=Array.from({length:120},(_,i)=>({best_effort_timestamp:i*512}));
test('full frame timestamps, not an average alone, certify CFR',()=>{
 const d=parseProbe(meta,frames,'/test.mov','size:mtime');assert.equal(d.durationFrames,'120');assert.deepEqual(d.frameRate,{numerator:24,denominator:1});
 const changed=frames.map(x=>({...x}));changed[50].best_effort_timestamp+=8;
 assert.throws(()=>parseProbe(meta,changed,'/test.mov','f'),/CFR/);
});
test('reject absent audio, multiple streams, rotation and delayed audio',()=>{
 for(const edit of [(m:any)=>m.streams.pop(),(m:any)=>m.streams.push({...m.streams[1]}),(m:any)=>m.streams[0].side_data_list=[{rotation:90}],(m:any)=>m.streams[1].start_time='0.1']){
 const m=structuredClone(meta);edit(m);assert.throws(()=>parseProbe(m,frames,'/test.mov','f'));
 }
});
test('wire PCM keeps opposite polarity and checks declared length',()=>{
 const raw=new ArrayBuffer(16),v=new DataView(raw);[.5,-.5,.25,-.25].forEach((x,i)=>v.setFloat32(i*4,x,true));
 const out=decodePcm(raw,{startSample:0,sampleCount:2,channels:2,sampleRate:48000,fileIdentity:'f'});
 assert.deepEqual([...out[0]],[.5,.25]);assert.deepEqual([...out[1]],[-.5,-.25]);
 assert.throws(()=>decodePcm(raw,{startSample:0,sampleCount:3,channels:2,sampleRate:48000,fileIdentity:'f'}),/length/);
 v.setFloat32(0,NaN,true);assert.throws(()=>decodePcm(raw,{startSample:0,sampleCount:2,channels:2,sampleRate:48000,fileIdentity:'f'}),/finite/);
});
const ff=process.env.PEA_TEST_FFMPEG??'/usr/bin/ffmpeg';const fp=process.env.PEA_TEST_FFPROBE??'/usr/bin/ffprobe';
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'pea-audio-'));const wav=join(dir,'input.wav');const count=240000,channels=2;const b=Buffer.alloc(44+count*channels*2);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(48000*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
 for(let i=0;i<count;i++){let x=[0,2,4].includes(Math.floor(i/48000))?Math.round(Math.sin(2*Math.PI*440*i/48000)*10000):0;b.writeInt16LE(x,44+i*4);b.writeInt16LE(-x,46+i*4);}
 await writeFile(wav,b);const mov=join(dir,'input.mov');
 execFileSync(ff,['-nostdin','-v','error','-f','lavfi','-i','color=c=black:s=160x90:r=24:d=5','-i',wav,'-c:v','mpeg4','-c:a','pcm_s16le','-shortest',mov]);return{dir,mov};
}
test('actual generated MOV decode preserves channels, exact ranges and source bytes',async()=>{
 const {dir,mov}=await fixture();try{
 const before=await readFile(mov);const p=createFFmpegMediaProvider({ffmpegPath:ff,ffprobePath:fp,allowedRoots:[dir]});const d=await p.probe(mov);
 const w=await p.readWindow({media:d,startSample:24000,sampleCount:48000});const c=decodePcm(w.data,w.meta);
 assert.equal(c[0].length,48000);assert(c[0].some((x:number)=>Math.abs(x)>.1));assert(c[0].slice(24000).every((x:number)=>x===0));assert(Math.abs(c[0][1]+c[1][1])<1e-6);assert.deepEqual(await readFile(mov),before);
 await assert.rejects(()=>p.readWindow({media:d,startSample:0,sampleCount:48000*6}),/limit/);
 await writeFile(mov,Buffer.concat([before,Buffer.from([0])]));await assert.rejects(()=>p.readWindow({media:d,startSample:0,sampleCount:10}),/changed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('reject files outside granted root and pre-aborted work',async()=>{
 const {dir,mov}=await fixture();try{
 const p=createFFmpegMediaProvider({ffmpegPath:ff,ffprobePath:fp,allowedRoots:[join(dir,'not-granted')]});await assert.rejects(()=>p.probe(mov),/root|ENOENT/);
 const q=createFFmpegMediaProvider({ffmpegPath:ff,ffprobePath:fp,allowedRoots:[dir]});const c=new AbortController();c.abort();await assert.rejects(()=>q.probe(mov,c.signal),{name:'AbortError'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
