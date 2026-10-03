import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {request as httpsRequest} from 'node:https';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createHelperServer} from './server.js';
import {noise,writeWave} from './fixture-utils.js';
import {validateSyncInput,runSyncJob} from './sync-job.js';
const require=createRequire(import.meta.url);
const {createClient}=require('../../premiere-sync-panel/client.js');
const {SyncController}=require('../../premiere-sync-panel/controller.js');

describe('panel client through TLS and real FFmpeg',()=>{
  it('runs the same panel controller/client over verified TLS and preserves a known offset',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'pea-panel-e2e-'));let helper:Awaited<ReturnType<typeof createHelperServer>>|undefined;
    try {
      const keyPath=join(dir,'key.pem'),certPath=join(dir,'cert.pem');
      execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
      const key=await readFile(keyPath),cert=await readFile(certPath);
      const a=join(dir,'reference.wav'),b=join(dir,'take.wav'),wave=noise(16000);
      await writeWave(a,wave);await writeWave(b,wave.slice(733));
      const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
      const before=[await hash(a),await hash(b)];
      helper=await createHelperServer({host:'127.0.0.1',port:0,tls:{key,cert}});
      // CA is scoped to this fixture's request, not a global bypass or trust-store install.
      const trustedFetch=(url:string,init:any)=>new Promise<Response>((resolve,reject)=>{
        const req=httpsRequest(url,{ca:cert,method:init.method,headers:init.headers,signal:init.signal},res=>{
          const chunks:Buffer[]=[];let length=0;
          res.on('data',(part:Buffer)=>{length+=part.length;if(length>65536){res.destroy(new Error('response limit'));return;}chunks.push(part)});
          res.once('error',reject);
          res.once('end',()=>{
            const headers:Record<string,string>={};for(const [name,value]of Object.entries(res.headers)){if(typeof value==='string')headers[name]=value;}
            resolve(new Response(res.statusCode===204?null:Buffer.concat(chunks).toString('utf8'),{status:res.statusCode,headers}));
          });
        });req.once('error',reject);req.end(init.body);
      });
      const controller=new SyncController({makeClient:(session:unknown)=>createClient(session,{fetchImpl:trustedFetch}),pollMs:5,isCurrent:async()=>true});
      await controller.connect({address:helper.address,sessionToken:helper.sessionToken,protocolVersion:1});
      controller.setSelection({projectKey:'generated-fixture',clips:[{clipId:'a',name:'A',path:a,startSample:'0'},{clipId:'b',name:'B',path:b,startSample:'0'}]},'a');
      await controller.run({sampleRate:8000,maxSamples:8000});
      const report=await controller.reviewReport();assert.equal(controller.state.phase,'completed');assert.equal(report.group.status,'matched');
      assert.equal(report.group.members.find((x:any)=>x.clipId==='b').offset.ticks,'733');
      assert.equal(report.analyses.length,2);assert.equal(report.humanReview,'pending');assert.ok(!JSON.stringify(report).includes(helper.sessionToken));
      assert.deepEqual([await hash(a),await hash(b)],before);
      console.log(JSON.stringify({check:'panel-client-https-ffmpeg-sync',expectedSamples:733,measuredSamples:733,sourceUnchanged:true}));
    }finally{await helper?.close();await rm(dir,{recursive:true,force:true})}
  },20000);
  it('does not release a cancelled Sync job until its pending decoder finishes cleanup',async()=>{
    const signal=new AbortController();let release!:()=>void,started!:()=>void,settled=false;
    const entered=new Promise<void>(r=>started=r),pending=new Promise<void>(r=>release=r);
    const input=validateSyncInput({referenceClipId:'a',sampleRate:8000,maxSamples:128,clips:[{clipId:'a',path:'/tmp/a.wav',startSample:'0'},{clipId:'b',path:'/tmp/b.wav',startSample:'0'}]});
    const result=runSyncJob(input,async(_path,request,rate)=>{started();await pending;return {samples:noise(128),sampleRate:rate,startSample:request.startSample}},signal.signal);
    result.then(()=>settled=true,()=>settled=true);await entered;signal.abort();
    await new Promise(r=>setTimeout(r,10));assert.equal(settled,false);release();await assert.rejects(()=>result,{name:'AbortError'});
  });
});
