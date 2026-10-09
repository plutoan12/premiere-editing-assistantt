import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runProcess} from './process-runner.js';
const opts={timeoutMs:2000,maxStdoutBytes:4096};
describe('process lifecycle regressions',()=>{
 it('does not spawn an already-cancelled request',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pea-abort-'));
  try{const file=join(dir,'should-not-exist');const c=new AbortController();c.abort();
   await assert.rejects(runProcess(process.execPath,['-e',`require('fs').writeFileSync(${JSON.stringify(file)},'ran')`],{...opts,signal:c.signal}),{name:'AbortError'});
   await assert.rejects(access(file));
  }finally{await rm(dir,{recursive:true,force:true})}
 });
 it('waits for actual child termination before rejecting cancellation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pea-kill-'));
  try{const pidfile=join(dir,'pid');const c=new AbortController();
   const p=runProcess(process.execPath,['-e',`require('fs').writeFileSync(${JSON.stringify(pidfile)},String(process.pid));setInterval(()=>{},1000)`],{...opts,signal:c.signal});
   for(let i=0;i<100;i++){try{await access(pidfile);break}catch{await new Promise(r=>setTimeout(r,10))}}
   const pid=Number(await readFile(pidfile,'utf8'));c.abort();
   await assert.rejects(p,{name:'AbortError'});
   assert.throws(()=>process.kill(pid,0),/ESRCH/);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
 it('rejects invalid limits before spawning',async()=>{
  for(const timeoutMs of [0,-1,NaN,2147483648])await assert.rejects(runProcess(process.execPath,['-e',''],{...opts,timeoutMs}),/timeout/i);
 });
 it('keeps shell metacharacters as one literal argument',async()=>{
  const s='a ; $(touch impossible) && b';const r=await runProcess(process.execPath,['-e','process.stdout.write(process.argv[1])',s],opts);assert.equal(r.stdout.toString(),s);
 });
 it('bounds stdout and stderr separately',async()=>{
  await assert.rejects(runProcess(process.execPath,['-e','process.stdout.write("x".repeat(5000))'],opts),/stdout/i);
  await assert.rejects(runProcess(process.execPath,['-e','process.stderr.write("x".repeat(50))'],{...opts,maxStderrBytes:8}),/stderr/i);
 });
 it('reports spawn failure without an uncaught child event',async()=>{
  await assert.rejects(runProcess('/__pea_missing_binary__',[],opts),/not found|start|ENOENT/i);
 });
});
