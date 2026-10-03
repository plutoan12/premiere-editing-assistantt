import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {get} from 'node:https';
import {createHelperServer} from './server.js';

const input={referenceClipId:'a',sampleRate:8000,maxSamples:256,clips:[{clipId:'a',path:'/tmp/a.wav',startSample:'0'},{clipId:'b',path:'/tmp/b.wav',startSample:'0'}]};
const headers={authorization:'Bearer test','content-type':'application/json','x-pea-protocol-version':'1'};
async function poll(address:string,id:string){
  for(let i=0;i<200;i++){
    const r=await fetch(`${address}/v1/jobs/${id}`,{headers});const job=await r.json() as any;
    if(['completed','failed','cancelled'].includes(job.status))return job;
    await new Promise(r=>setTimeout(r,5));
  }
  throw new Error('job did not settle');
}
function noise(n:number){let seed=31;return Float32Array.from({length:n},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/4294967296-.5)*1.5})}

describe('Sync panel helper contract',()=>{
  it('advertises sync capability on authenticated handshake',async()=>{
    const h=await createHelperServer({host:'127.0.0.1',port:0,sessionToken:'test'});
    try{const r=await fetch(h.address+'/v1/ping',{headers});const body=await r.json() as any;assert.ok(body.capabilities?.includes('sync'));}finally{await h.close()}
  });
  it('runs sync job with exact signed decimal-string offsets and no PCM result',async()=>{
    const x=noise(512);let reads=0;
    const h=await createHelperServer({host:'127.0.0.1',port:0,sessionToken:'test',audio:async(path,request,rate)=>{reads++;return {samples:path==='/tmp/a.wav'?x.slice(0,256):x.slice(17,273),startSample:request.startSample,sampleRate:rate}}});
    try{
      const r=await fetch(h.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind:'sync',input})});assert.equal(r.status,202);
      const job=await poll(h.address,(await r.json() as any).id);assert.equal(job.status,'completed');assert.equal(job.result.group.status,'matched');
      assert.equal(job.result.group.members.find((x:any)=>x.clipId==='b').offset.ticks,'17');assert.equal(reads,2);assert.ok(!JSON.stringify(job.result).includes('samples":['));
    }finally{await h.close()}
  });
  it('rejects duplicate clip IDs before decoding',async()=>{
    let reads=0;const h=await createHelperServer({host:'127.0.0.1',port:0,sessionToken:'test',audio:async()=>{reads++;throw new Error('unexpected')}});
    try{const r=await fetch(h.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind:'sync',input:{...input,clips:[input.clips[0],input.clips[0]]}})});assert.equal(r.status,400);assert.equal(reads,0);}finally{await h.close()}
  });
  it('preserves matched targets when another target is silent',async()=>{
    const x=noise(256);const h=await createHelperServer({host:'127.0.0.1',port:0,sessionToken:'test',audio:async(path,request,rate)=>({samples:path.endsWith('c.wav')?new Float32Array(256):x,startSample:request.startSample,sampleRate:rate})});
    try{const r=await fetch(h.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind:'sync',input:{...input,clips:[...input.clips,{clipId:'c',path:'/tmp/c.wav',startSample:'0'}]}})});assert.equal(r.status,202);const job=await poll(h.address,(await r.json() as any).id);assert.equal(job.result.group.status,'partial');assert.equal(job.result.group.candidates.find((x:any)=>x.clipId==='c').reason,'SILENCE');}finally{await h.close()}
  });
  it('supports a verified HTTPS connection without bypassing trust',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'pea-tls-test-'));
    let h:Awaited<ReturnType<typeof createHelperServer>>|undefined;
    try{
      execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
      const key=await readFile(join(dir,'key.pem')),cert=await readFile(join(dir,'cert.pem'));
      h=await createHelperServer({host:'127.0.0.1',port:0,sessionToken:'test',tls:{key,cert}} as any);assert.match(h.address,/^https:\/\//);
      const read=(ca?:Buffer)=>new Promise<number>((resolve,reject)=>{get(h!.address+'/v1/ping',{ca,headers},r=>{r.resume();resolve(r.statusCode!)}).once('error',reject)});
      await assert.rejects(()=>read());assert.equal(await read(cert),200);
    }finally{await h?.close();await rm(dir,{recursive:true,force:true})}
  });
});
