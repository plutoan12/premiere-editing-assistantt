// Generated test media only. This script never reads user production footage.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const arg=process.argv[2];if(!arg)throw new Error('Usage: pnpm sync:demo <new-fixture-directory>');
const dir=resolve(arg);await mkdir(dir,{recursive:false});
const rate=48000;let state=72;const samples=Float32Array.from({length:rate*6},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state/2**32-.5)*.6;});
function wav(samples){const b=Buffer.alloc(44+samples.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples.length*2,40);samples.forEach((x,i)=>b.writeInt16LE(Math.round(x*30000),44+i*2));return b;}
await writeFile(join(dir,'recorder.wav'),wav(samples));await writeFile(join(dir,'take-audio.wav'),wav(samples.slice(66000,258000)));
function video(name,audio,duration){const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i',`testsrc2=s=320x180:r=24:d=${duration}`,'-i',join(dir,audio),'-map','0:v:0','-map','1:a:0','-c:v','mpeg4','-q:v','4','-c:a','pcm_s16le','-shortest',join(dir,name)],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr||String(result.error));}
video('camera-a.mov','recorder.wav',6);video('camera-b.mov','take-audio.wav',4);
const job={schemaVersion:'1.0.0',name:'PEA generated sync acceptance demo',referenceClipId:'recorder',files:[{clipId:'recorder',path:'recorder.wav'},{clipId:'camera-a',path:'camera-a.mov'},{clipId:'camera-b',path:'camera-b.mov'}],analysis:{sampleRate:8000,windowSeconds:8},sequence:{frameRate:{rate:{numerator:24,denominator:1},dropFrame:false},width:320,height:180,rounding:'reject'}};
await writeFile(join(dir,'job.json'),JSON.stringify(job,null,2)+'\n');
await writeFile(join(dir,'FIXTURE-NOT-REAL-FOOTAGE.txt'),'Generated synthetic audio/video. Expected: camera-a=0, camera-b=1.375s=33 frames at 24fps relative to recorder.\n');
console.log(join(dir,'job.json'));
