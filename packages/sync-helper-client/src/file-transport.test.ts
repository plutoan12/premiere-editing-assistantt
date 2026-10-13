import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileHelper } from '../../../apps/native-helper/src/file-helper.js';
import { encodeWire, decodeWire } from '../../../apps/native-helper/src/file-protocol.js';
import { connectFileHelper } from './file-client.js';
export function diskFolder(dir:string) {
  function file(path:string) { return {isFile:true, read:()=>readFile(path,'utf8'), write:async(s:string)=>{await writeFile(path,s);}, delete:()=>rm(path,{force:true})}; }
  return { getEntry:async(name:string)=>{assert.equal(name.includes('/'),false);const p=join(dir,name);await stat(p);return file(p);},
    createFile:async(name:string,options:{overwrite:boolean})=>{assert.equal(name.includes('/'),false);const p=join(dir,name);await writeFile(p,'',{flag:options.overwrite?'w':'wx'});return file(p);} };
}
async function root(){return mkdtemp(join(tmpdir(),'pea-file-tests-'));}
test('wire format round-trips signed bigint without coercing ordinary numeric strings',()=>{
  assert.deepEqual(decodeWire(encodeWire({ticks:-12345678901234567890n,name:'12'})),{ticks:-12345678901234567890n,name:'12'});
  assert.throws(()=>decodeWire('{"$peaBigInt":"1e99"}'),/bigint/i);
});
test('file helper handshake authenticates a fresh private session',async()=>{
  const d=await root(),h=await createFileHelper({sessionRoot:d,pollMs:10});
  try { const client=await connectFileHelper(diskFolder(h.directory),{pollMs:10,timeoutMs:2000});
    assert.equal((await client.request('ping',{}) as {version:string}).version,'0.2.0');
    assert.equal((await stat(h.directory)).mode&0o777,0o700);
  } finally {await h.close();await rm(d,{recursive:true,force:true});}
});
test('bad token is rejected before request execution',async()=>{
  const d=await root(),h=await createFileHelper({sessionRoot:d,pollMs:10});
  try { const f=join(h.directory,'session.json'),s=JSON.parse(await readFile(f,'utf8'));s.token='d'.repeat(64);await writeFile(f,JSON.stringify(s));
    await assert.rejects(connectFileHelper(diskFolder(h.directory),{pollMs:10,timeoutMs:2000}),/UNAUTHORIZED/);
  } finally {await h.close();await rm(d,{recursive:true,force:true});}
});
test('oversized windows are rejected before any media is read',async()=>{
  const d=await root(),h=await createFileHelper({sessionRoot:d,pollMs:10});
  try {const c=await connectFileHelper(diskFolder(h.directory),{pollMs:10,timeoutMs:2000});
    await assert.rejects(c.request('sync',{sources:[{clipId:'a',path:'/absent-a.wav',outSeconds:8},{clipId:'b',path:'/absent-b.wav',outSeconds:8}],referenceClipId:'a',mode:'audio',sampleRate:8000,startSeconds:0,durationSeconds:1000}),/WINDOW_TOO_LARGE/);
  } finally {await h.close();await rm(d,{recursive:true,force:true});}
});
test('cancelled requests cannot turn a later result into success',async()=>{
  const d=await root(),h=await createFileHelper({sessionRoot:d,pollMs:10});
  try {const c=await connectFileHelper(diskFolder(h.directory),{pollMs:10,timeoutMs:2000});const ac=new AbortController();ac.abort();
    await assert.rejects(c.request('ping',{}, {signal:ac.signal}),{name:'AbortError'});
  } finally {await h.close();await rm(d,{recursive:true,force:true});}
});
test('a stale session folder times out instead of reporting connected',async()=>{
  const d=await root();await writeFile(join(d,'session.json'),JSON.stringify({protocol:'pea-file-v1',version:'0.2.0',id:'a'.repeat(32),token:'b'.repeat(64)}));
  try{await assert.rejects(connectFileHelper(diskFolder(d),{pollMs:5,timeoutMs:35}),/TIMEOUT/);}finally{await rm(d,{recursive:true,force:true});}
});
