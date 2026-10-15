import { describe,it } from 'vitest';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import * as api from './server.js';
import type { MediaService } from './media.js';
import { noise } from './test-fixtures.js';
const info={assetId:'asset',revision:'revision',revisionKind:'stat-v1',audio:[{index:0,sampleRate:8000,channels:1}],video:[],startSeconds:0,durationSeconds:1,format:'wav'};
function fakeMedia(){return {
 async register(){return structuredClone(info);},info(){return structuredClone(info);},async read(_id:string,spec:any){
  const samples=noise(spec.sampleCount??128),pcm=Buffer.alloc(samples.length*4);samples.forEach((x,i)=>pcm.writeFloatLE(x,i*4));
  return {window:{samples,sampleRate:spec.sampleRate??8000,startSample:BigInt(spec.startSample??'0')},pcm,sha256:createHash('sha256').update(pcm).digest('hex'),policy:{stream:0,channel:0,sampleRate:8000,origin:'clip-start',resample:'ffmpeg-aresample'}};
 }} as unknown as MediaService;}
async function fixture(fn:(s:api.HelperServer)=>Promise<void>,origins?:string[]){assert.equal(typeof api.startHelper,'function');const s=await api.startHelper({media:fakeMedia(),allowedOrigins:origins});try{await fn(s);}finally{await s.close();}}
function headers(s:api.HelperServer){return {'Authorization':`Bearer ${s.token}`,'X-PEA-Protocol':'1','Content-Type':'application/json'};}
async function post(s:api.HelperServer,path:string,body:unknown,extra:Record<string,string>={}){return fetch(s.url+path,{method:'POST',headers:{...headers(s),...extra},body:JSON.stringify(body)});}
function rawStatus(url:string,host:string){return new Promise<number>((resolve,reject)=>{const r=httpRequest(url,{headers:{Host:host}},res=>{res.resume();resolve(res.statusCode!);});r.on('error',reject);r.end();});}
describe('local authenticated helper HTTP',()=>{
 it('binds only loopback and health does not leak credentials',async()=>fixture(async s=>{
  assert.ok(s.url.startsWith('http://127.0.0.1:'));assert.match(s.token,/^[0-9a-f]{64}$/);const r=await fetch(s.url+'/health'),body=await r.text();assert.equal(r.status,200);assert.ok(!body.includes(s.token));assert.equal(JSON.parse(body).protocolVersion,1);
 }));
 it('uses a fresh random token per server',async()=>fixture(async a=>fixture(async b=>{assert.notEqual(a.token,b.token);}))); 
 it('rejects missing/wrong bearer tokens and query-string authentication',async()=>fixture(async s=>{
  assert.equal((await fetch(s.url+'/v1/jobs/x')).status,401);
  assert.equal((await fetch(s.url+'/v1/jobs/x',{headers:{Authorization:'Bearer invalid'}})).status,401);
  assert.notEqual((await fetch(s.url+'/v1/jobs/x?token='+s.token)).status,200);
 }));
 it('rejects DNS rebinding Host headers',async()=>fixture(async s=>{assert.equal(await rawStatus(s.url+'/health','attacker.example'),403);}));
 it('rejects foreign and null browser origins even with a correct token',async()=>fixture(async s=>{
  for(const origin of ['https://attacker.example','null'])assert.equal((await fetch(s.url+'/health',{headers:{...headers(s),Origin:origin}})).status,403);
 }));
 it('allows only explicitly configured browser-origin preflights',async()=>fixture(async s=>{
  const r=await fetch(s.url+'/v1/media/probe',{method:'OPTIONS',headers:{Origin:'https://panel.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,x-pea-protocol'}});
  assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://panel.example');
 },['https://panel.example']));
 it('checks protocol compatibility before running operations',async()=>fixture(async s=>{
  const r=await post(s,'/v1/media/probe',{path:'/anything'},{'X-PEA-Protocol':'2'});assert.equal(r.status,409);
 }));
 it('rejects oversized, malformed, and unknown request fields',async()=>fixture(async s=>{
  assert.equal((await post(s,'/v1/media/probe',{path:'x'.repeat(70000)})).status,413);
  assert.equal((await post(s,'/v1/media/probe',{path:'/file',command:'rm'})).status,400);
  assert.equal((await fetch(s.url+'/v1/media/probe',{method:'POST',headers:headers(s),body:'{broken'})).status,400);
 }));
 it('serves bounded binary PCM and explicit metadata, not JSON sample arrays',async()=>fixture(async s=>{
  const r=await post(s,'/v1/audio/window',{assetId:'asset',window:{sampleCount:128,startSample:'32'}});
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.equal(r.headers.get('x-pea-start-sample'),'32');assert.equal((await r.arrayBuffer()).byteLength,512);
 }));
 it('rejects unsupported routes without accepting arbitrary actions',async()=>fixture(async s=>{
  assert.equal((await post(s,'/v1/exec',{command:'echo nope'})).status,404);
 }));
 it('creates and retrieves exact-time sync job results',async()=>fixture(async s=>{
  const r=await post(s,'/v1/jobs',{kind:'sync',clips:[{clipId:'a',assetId:'asset',window:{sampleCount:128}},{clipId:'b',assetId:'asset',window:{sampleCount:128}}]});assert.equal(r.status,202);const j=await r.json() as any;
  let done:any;for(let i=0;i<100;i++){done=await (await fetch(s.url+'/v1/jobs/'+j.id,{headers:headers(s)})).json();if(!['queued','running'].includes(done.status))break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(done.status,'completed');assert.equal(done.result.group.candidates[0].offset.ticks,'0');
  const del=await fetch(s.url+'/v1/jobs/'+j.id,{method:'DELETE',headers:headers(s)});assert.equal(del.status,204);
 }));
});
describe('HTTP disconnect cleanup',()=>{
 it('survives a client abort in the middle of a JSON body',async()=>fixture(async s=>{
  await new Promise<void>(resolve=>{
   const req=httpRequest(s.url+'/v1/media/probe',{method:'POST',headers:{...headers(s),'Content-Length':'1000'}},res=>res.resume());
   req.on('error',()=>resolve());req.write('{"path":"');setTimeout(()=>{req.destroy();resolve();},20);
  });
  await new Promise(r=>setTimeout(r,20));assert.equal((await fetch(s.url+'/health')).status,200);
 }));
});
