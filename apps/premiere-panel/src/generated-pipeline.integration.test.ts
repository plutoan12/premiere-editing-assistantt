import {test} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createFileHelper} from '../../native-helper/src/file-helper.js';
import {connectFileHelper} from '@pea/sync-helper-client/file';
import {SyncController} from './sync-controller.js';
import {createPremiereUxpHost,readPremiereSelection} from './premiere-host.js';
import {premiereFixture} from './test-fixtures.js';
function diskFolder(dir:string){
  const file=(p:string)=>({read:()=>readFile(p,'utf8'),write:(s:string)=>writeFile(p,s),delete:()=>rm(p,{force:true})});
  return{getEntry:async(n:string)=>{const p=join(dir,n);await readFile(p);return file(p);},createFile:async(n:string,o:{overwrite:boolean})=>{const p=join(dir,n);await writeFile(p,'',{flag:o.overwrite?'w':'wx'});return file(p);}};
}
function ffmpeg(args:string[]){execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',...args],{timeout:15000,stdio:'pipe'});}
async function fixtures(){
  const dir=await mkdtemp(join(tmpdir(),'pea-generated-'));const raw=Buffer.alloc(16000*4);let seed=731;
  for(let i=0;i<16000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw.writeFloatLE((seed/4294967296-.5)*.7,i*4);}
  await writeFile(join(dir,'input.raw'),raw);
  ffmpeg(['-f','f32le','-ar','8000','-ac','1','-i',join(dir,'input.raw'),'-c:a','pcm_s16le',join(dir,'master.wav')]);
  ffmpeg(['-i',join(dir,'master.wav'),'-ss','0.25','-c:a','pcm_s16le',join(dir,'take.wav')]);
  return dir;
}
const enabled=process.env.PEA_FFMPEG_INTEGRATION==='1';
test('generated WAV and MOV pass real FFmpeg/file jobs through controller to native-host fixture readback',{skip:!enabled},async()=>{
  const dir=await fixtures(),helper=await createFileHelper({sessionRoot:dir,pollMs:10});
  try{
    ffmpeg(['-f','lavfi','-i','color=black:s=64x64:r=24:d=1.75','-i',join(dir,'take.wav'),'-c:v','mpeg4','-c:a','pcm_s16le','-shortest',join(dir,'camera.mov')]);
    const client=await connectFileHelper(diskFolder(helper.directory),{pollMs:10,timeoutMs:20000});
    for(const extension of ['take.wav','camera.mov']){
      const f=premiereFixture();f.items[0].path=join(dir,'master.wav');f.items[0].outSeconds=2;f.items[1].path=join(dir,extension);f.items[1].outSeconds=1.75;
      const c=new SyncController({readSelection:()=>readPremiereSelection(f.ppro as never),createHost:b=>createPremiereUxpHost(f.ppro as never,b)});c.connect(client);
      await c.analyze({referenceClipId:'a',mode:'audio',sampleRate:8000,startSeconds:0,durationSeconds:2});
      assert.equal(c.view.rows[0].status,'matched');assert.ok(Math.abs(c.view.rows[0].offsetSeconds!-.25)<=1/8000);
      await c.dryRun('Generated '+extension);assert.equal(f.audit.length,0);
      const result=await c.apply(true);assert.deepEqual(result.applied,['a','b']);assert.deepEqual(result.readbackIssues,[]);
      assert.equal(f.sequences[1].placements[1].seconds,.25);
    }
    assert.equal((await readdir(helper.directory)).some(n=>n.startsWith('cache-')),false);
  }finally{await helper.close();await rm(dir,{recursive:true,force:true});}
});
test('cancelling an active file job terminates its owned decoder child',{skip:!enabled},async()=>{
  const dir=await fixtures(),pidPath=join(dir,'decoder.pid'),fake=join(dir,'slow-decoder.cjs');
  await writeFile(fake,`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000);\n`,{mode:0o700});
  const helper=await createFileHelper({sessionRoot:dir,pollMs:10,ffmpegPath:fake});
  try{
    const c=await connectFileHelper(diskFolder(helper.directory),{pollMs:10,timeoutMs:5000}),ac=new AbortController();
    const task=c.request('sync',{sources:[{clipId:'a',path:join(dir,'master.wav'),outSeconds:2},{clipId:'b',path:join(dir,'take.wav'),outSeconds:1.75}],referenceClipId:'a',mode:'audio',sampleRate:8000,startSeconds:0,durationSeconds:2},{signal:ac.signal});
    const assertion=assert.rejects(task,{name:'AbortError'});let pid=0;
    for(let i=0;i<150;i++){try{pid=Number(await readFile(pidPath,'utf8'));break;}catch{await new Promise(r=>setTimeout(r,10));}}
    assert.ok(pid>0,'decoder never started');ac.abort();await assertion;
    let exited=false;for(let i=0;i<150;i++){try{process.kill(pid,0);}catch{exited=true;break;}await new Promise(r=>setTimeout(r,10));}
    assert.equal(exited,true,'owned decoder remained alive after cancel');
  }finally{await helper.close();await rm(dir,{recursive:true,force:true});}
});
