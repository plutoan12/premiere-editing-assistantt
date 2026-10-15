import { describe,it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,stat,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as api from './session.js';
import * as launch from './launch.js';
async function fixture(fn:(parent:string)=>Promise<void>){const p=await mkdtemp(join(tmpdir(),'pea-session-test-'));try{await fn(p);}finally{await rm(p,{recursive:true,force:true});}}
describe('private session bootstrap and CLI',()=>{
 it('creates a private non-overwriting session file',async()=>fixture(async parent=>{
  assert.equal(typeof api.createSession,'function');const s=await api.createSession(parent,{url:'http://127.0.0.1:12345',token:'a'.repeat(64)});const file=JSON.parse(await readFile(s.path,'utf8'));
  assert.equal(file.protocolVersion,1);assert.equal(file.token,'a'.repeat(64));assert.equal((await stat(s.path)).mode&0o777,0o600);assert.equal((await stat(s.directory)).mode&0o777,0o700);await s.remove();await assert.rejects(stat(s.path));
 }));
 it('does not overwrite another helper session',async()=>fixture(async parent=>{
  const a=await api.createSession(parent,{url:'http://127.0.0.1:12345',token:'a'.repeat(64)}),b=await api.createSession(parent,{url:'http://127.0.0.1:12346',token:'b'.repeat(64)});assert.notEqual(a.path,b.path);await a.remove();assert.equal(JSON.parse(await readFile(b.path,'utf8')).token,'b'.repeat(64));await b.remove();
 }));
 it('does not recursively delete unexpected user files during cleanup',async()=>fixture(async parent=>{
  const s=await api.createSession(parent,{url:'http://127.0.0.1:12345',token:'a'.repeat(64)});await writeFile(join(s.directory,'keep.txt'),'keep');await s.remove();assert.equal(await readFile(join(s.directory,'keep.txt'),'utf8'),'keep');
 }));
 it('requires explicit roots before starting a server',()=>{assert.equal(typeof launch.parseArguments,'function');assert.throws(()=>launch.parseArguments([]),{code:'ROOT_REQUIRED'});});
 it('accepts multiple roots but not unknown flags',()=>{const c=launch.parseArguments(['--media-root','/one','--media-root','/two']);assert.deepEqual(c.roots,['/one','/two']);assert.throws(()=>launch.parseArguments(['--shell','echo bad']));});
 it('permits help and executable checks without scanning media folders',()=>{assert.equal(launch.parseArguments(['--help']).help,true);assert.equal(launch.parseArguments(['--check']).check,true);});
});
