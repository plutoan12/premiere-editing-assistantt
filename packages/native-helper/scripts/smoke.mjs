import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const bundle=process.env.PEA_SMOKE_BUNDLE??fileURLToPath(new URL('../dist/pea-helper.mjs',import.meta.url));
const root=await mkdtemp(join(tmpdir(),'pea-bundle-smoke-'));
let child,sessionPath,stdout='',stderr='';
const wav=(samples)=>{const b=Buffer.alloc(44+samples.length*2);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples.length*2,40);samples.forEach((x,i)=>b.writeInt16LE(Math.round(x*32767),44+i*2));return b;};
try {
  let seed=19;const x=Float32Array.from({length:16000},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/4294967296-.5)*.8;});
  await writeFile(join(root,'master.wav'),wav(x));await writeFile(join(root,'take.wav'),wav(x.slice(500)));
  child=spawn(process.execPath,[resolve(bundle),'--media-root',root,'--session-parent',root],{stdio:['ignore','pipe','pipe']});
  const stopped=new Promise(resolve=>child.once('exit',resolve));
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4096);});
  const launch=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Helper startup timed out: '+stderr)),10000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.stdout.on('data',b=>{stdout+=b;if(stdout.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(stdout.split('\n')[0]));}catch(error){reject(error);}}});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Helper exited during startup: '+code+' '+stderr));});
  });
  sessionPath=launch.sessionFile;const session=JSON.parse(await readFile(sessionPath,'utf8'));
  assert.equal(stdout.includes(session.token),false);assert.equal(stderr.includes(session.token),false);
  const headers={Authorization:`Bearer ${session.token}`,'X-PEA-Protocol':'1','Content-Type':'application/json'};
  const post=async(path,body)=>{const r=await fetch(session.url+path,{method:'POST',headers,body:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return r.json();};
  assert.equal((await fetch(session.url+'/health')).status,200);
  assert.equal((await fetch(session.url+'/v1/jobs/invalid')).status,401);
  const a=await post('/v1/media/probe',{path:join(root,'master.wav')}),b=await post('/v1/media/probe',{path:join(root,'take.wav')});
  const job=await post('/v1/jobs',{kind:'sync',clips:[{clipId:'master',assetId:a.assetId,window:{sampleCount:8000}},{clipId:'take',assetId:b.assetId,window:{sampleCount:8000}}]});
  let done;for(let i=0;i<200;i++){done=await(await fetch(session.url+'/v1/jobs/'+job.id,{headers})).json();if(!['running','queued'].includes(done.status))break;await new Promise(r=>setTimeout(r,25));}
  assert.equal(done.status,'completed');assert.equal(done.result.group.status,'matched');assert.equal(done.result.group.candidates[0].offset.ticks,'500');
  child.kill('SIGTERM');await Promise.race([stopped,new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Shutdown timeout')),5000);t.unref();})]);
  await assert.rejects(access(sessionPath));
  console.log(JSON.stringify({status:'passed',fixture:'generated WAV',expectedOffsetSamples:500,measuredOffsetSamples:500,tokenLeaked:false,sessionCleaned:true}));
} finally {
  child?.kill('SIGKILL');await rm(root,{recursive:true,force:true});
}
