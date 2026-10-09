import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {createHelperServer} from './server.js';
import {request as httpRequest} from 'node:http';
const headers={authorization:'Bearer test-session','content-type':'application/json'};
const setup=()=>({host:'127.0.0.1',port:0,sessionToken:'test-session'});
const pause=()=>new Promise<void>(r=>setTimeout(r,5));
async function finished(address:string,id:string){for(let i=0;i<100;i++){const r=await fetch(`${address}/v1/jobs/${id}`,{headers});const b=await r.json();if(['completed','failed','cancelled'].includes(b.status))return b;await pause()}throw new Error('job did not settle')}
describe('HTTP media and job contracts',()=>{
 it('serves bounded PCM as binary with exact decimal origin metadata',async()=>{
  const h=await createHelperServer({...setup(),audio:async(_path,request,rate)=>({samples:Float32Array.of(.25,-.5),startSample:request.startSample,sampleRate:rate})});
  try{const r=await fetch(h.address+'/v1/audio/window',{method:'POST',headers,body:JSON.stringify({path:'/tmp/a.wav',startSample:'25',maxSamples:2,sampleRate:8000})});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.equal(r.headers.get('x-pea-start-sample'),'25');const data=Buffer.from(await r.arrayBuffer());assert.equal(data.length,8);assert.equal(data.readFloatLE(4),-.5)}finally{await h.close()}
 });
 it('requires authentication before any audio/job work',async()=>{
  let calls=0;const h=await createHelperServer({...setup(),audio:async()=>{calls++;throw new Error('not allowed')}});
  try{for(const path of ['/v1/audio/window','/v1/jobs','/v1/jobs/a/audio']){const r=await fetch(h.address+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,401)}assert.equal(calls,0)}finally{await h.close()}
 });
 it('runs probe jobs and deletes only finished jobs',async()=>{
  const h=await createHelperServer({...setup(),probe:async()=>({durationSeconds:2,audioStreams:[],videoStreams:[]})});
  try{const r=await fetch(h.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind:'media-probe',input:{path:'/tmp/a.wav'}})});assert.equal(r.status,202);const {id}=await r.json();const job=await finished(h.address,id);assert.equal(job.status,'completed');assert.equal(job.result.durationSeconds,2);assert.equal((await fetch(h.address+'/v1/jobs/'+id,{method:'DELETE',headers})).status,204);assert.equal((await fetch(h.address+'/v1/jobs/'+id,{headers})).status,404)}finally{await h.close()}
 });
 it('keeps audio data out of JSON job polling and serves a protected binary result',async()=>{
  const h=await createHelperServer({...setup(),audio:async(_path,request,rate)=>({samples:Float32Array.of(.25),startSample:request.startSample,sampleRate:rate})});
  try{const r=await fetch(h.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind:'audio-window',input:{path:'/tmp/a.wav',startSample:'0',maxSamples:1}})});assert.equal(r.status,202);const {id}=await r.json();const job=await finished(h.address,id);assert.equal(job.result.sampleCount,1);assert.equal(job.result.samples,undefined);const b=await fetch(h.address+job.result.audioUrl,{headers});assert.equal(b.status,200);assert.equal((await b.arrayBuffer()).byteLength,4);assert.equal((await fetch(h.address+job.result.audioUrl)).status,401)}finally{await h.close()}
 });
 it('propagates job cancellation to the operation and does not expose a result',async()=>{
  let started=false,aborted=false;
  const h=await createHelperServer({...setup(),probe:async(_path,signal)=>new Promise((_ok,reject)=>{started=true;signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('stop'))},{once:true})})});
  try{const r=await fetch(h.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind:'media-probe',input:{path:'/tmp/a.wav'}})});assert.equal(r.status,202);const {id}=await r.json();for(let i=0;!started&&i<100;i++)await pause();for(let i=0;i<2;i++)assert.equal((await fetch(`${h.address}/v1/jobs/${id}/cancel`,{method:'POST',headers})).status,200);const job=await finished(h.address,id);assert.equal(job.status,'cancelled');assert.equal(job.result,undefined);assert.equal(aborted,true)}finally{await h.close()}
 });
 it('rejects bad JSON, null inputs, unknown kinds and unbounded windows',async()=>{
  const h=await createHelperServer(setup());
  try{for(const [route,data] of [['/v1/media/probe','null'],['/v1/media/probe','{'],['/v1/jobs','{"kind":"shell","input":{}}'],['/v1/audio/window','{"path":"/tmp/x","maxSamples":262145,"startSample":"0"}'],['/v1/audio/window','{"path":"/tmp/x","maxSamples":2,"startSample":0}']]){const r=await fetch(h.address+route,{method:'POST',headers,body:data});assert.equal(r.status,400,`${route} ${data}`)}}finally{await h.close()}
 });
 it('rejects browser origins, DNS-rebinding Host values and incompatible protocols',async()=>{
  const h=await createHelperServer(setup());
  try{assert.equal((await fetch(h.address+'/health',{headers:{origin:'https://malicious.example'}})).status,403);assert.equal(await new Promise<number>(resolve=>{httpRequest(h.address+'/health',{headers:{host:'malicious.example'}},r=>{r.resume();resolve(r.statusCode!)}).end()}),403);assert.equal((await fetch(h.address+'/v1/ping',{headers:{...headers,'x-pea-protocol-version':'2'}})).status,409)}finally{await h.close()}
 });
 it('never returns raw process errors or paths to clients',async()=>{
  const h=await createHelperServer({...setup(),probe:async()=>{throw new Error('SECRET_TOKEN /Users/private/production.mov')}});
  try{const r=await fetch(h.address+'/v1/media/probe',{method:'POST',headers,body:'{"path":"/tmp/a.wav"}'});assert.equal(r.status,500);assert.ok(!(await r.text()).includes('SECRET_TOKEN'))}finally{await h.close()}
 });
});

describe('HTTP framing limits',()=>{
 it('returns 413 for chunked bodies without destroying the response',async()=>{
  const h=await createHelperServer(setup());
  try{const status=await new Promise<number>((resolve,reject)=>{const q=httpRequest(h.address+'/v1/media/probe',{method:'POST',headers},r=>{r.resume();resolve(r.statusCode!)});q.on('error',reject);q.write('x'.repeat(70000));q.end()});assert.equal(status,413)}finally{await h.close()}
 });
});
