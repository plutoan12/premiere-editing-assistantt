import {test} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runProcess} from './process-runner.js';
import {createHelperServer} from './server.js';
test('authenticated HTTP jobs measure, render and retain validated artifacts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pea-dsp-http-'));let server:Awaited<ReturnType<typeof createHelperServer>>|undefined;
 try{
  const path=join(root,'source.wav');const r=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=2','-c:a','pcm_f32le','-y',path],{timeoutMs:10000,maxStdoutBytes:0});assert.equal(r.code,0);
  server=await createHelperServer({host:'127.0.0.1',port:0,audioOutputRoot:root});
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${server.sessionToken}`};
  const input={path,streamIndex:0,monoPolicy:'native'};
  const unauthorized=await fetch(server.address+'/v1/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'audio-measure',input})});assert.equal(unauthorized.status,401);
  for(const kind of ['audio-measure','audio-normalize']){
   const body={kind,input:kind==='audio-measure'?input:{...input,approved:true,allowDynamic:true,target:{integratedLufs:-23,truePeakDbtp:-2,loudnessRangeLu:11}}};
   const submitted:Response=await fetch(server.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(submitted.status,202);
   const {id}=await submitted.json() as {id:string};let done=false;
   for(let i=0;i<300;i++){
    const response:Response=await fetch(server.address+`/v1/jobs/${id}`,{headers});assert.equal(response.status,200);
    const job=await response.json() as {status:string;result?:{sampleCount?:number;normalizationMode?:string;humanReview?:string};error?:unknown};
    if(job.status==='failed')assert.fail(JSON.stringify(job.error));
    if(job.status==='completed'){
     if(kind==='audio-measure')assert.equal(job.result?.sampleCount,96000);else{assert.ok(job.result?.normalizationMode);assert.equal(job.result?.humanReview,'pending');}
     done=true;break;
    }await new Promise(resolve=>setTimeout(resolve,20));
   }assert.equal(done,true);assert.equal((await fetch(server.address+`/v1/jobs/${id}`,{method:'DELETE',headers})).status,204);
  }
  assert.equal((await readdir(root)).filter(n=>n.startsWith('pea-audio-')).length,1);
  const invalid=await fetch(server.address+'/v1/jobs',{method:'POST',headers,body:JSON.stringify({kind:'audio-measure',input:{...input,filter:'arbitrary'}})});assert.equal(invalid.status,400);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
},20000);
