import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as api from './process.js';
const opts={timeoutMs:2000,maxOutputBytes:1024};
describe('bounded child process',()=>{
  it('exposes a process runner',()=>assert.equal(typeof api.runProcess,'function'));
  it('returns stdout without a shell',async()=>{
    const arg='$(touch /should-not-exist); `echo nope`';
    const b=await api.runProcess(process.execPath,['-e','process.stdout.write(process.argv[1])',arg],opts);
    assert.equal(b.toString(),arg);
  });
  it('rejects nonzero status with sanitized errors',async()=>{
    await assert.rejects(api.runProcess(process.execPath,['-e','console.error("PRIVATE PATH /secret");process.exit(3)'],opts),{code:'PROCESS_FAILED'});
  });
  it('reports missing executable',async()=>{
    await assert.rejects(api.runProcess('/missing/pea-executable',[],opts),{code:'EXECUTABLE_MISSING'});
  });
  it('bounds output before collecting unlimited chunks',async()=>{
    await assert.rejects(api.runProcess(process.execPath,['-e','process.stdout.write("x".repeat(100000))'],opts),{code:'OUTPUT_LIMIT'});
  });
  it('enforces timeout',async()=>{
    await assert.rejects(api.runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{...opts,timeoutMs:80}),{code:'PROCESS_TIMEOUT'});
  });
  it('does not start pre-cancelled work',async()=>{
    await assert.rejects(api.runProcess('/missing',[],{...opts,signal:AbortSignal.abort()}),{name:'AbortError'});
  });
  it('terminates running work on cancellation',async()=>{
    const c=new AbortController(); const p=api.runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{...opts,signal:c.signal});
    setTimeout(()=>c.abort(),80); await assert.rejects(p,{name:'AbortError'});
  });
  it('force-kills a child that ignores SIGTERM',async()=>{
    const start=Date.now();
    await assert.rejects(api.runProcess(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},10)'],{...opts,timeoutMs:200}),{code:'PROCESS_TIMEOUT'});
    assert.ok(Date.now()-start<2500);
  });
});
