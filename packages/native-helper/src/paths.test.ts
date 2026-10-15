import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from './paths.js';
async function fixture(fn:(root:string,outside:string)=>Promise<void>){
 const base=await mkdtemp(join(tmpdir(),'pea-path-'));const root=join(base,'allowed');await mkdir(root);await writeFile(join(base,'private.txt'),'private');
 try{await fn(root,join(base,'private.txt'));}finally{await rm(base,{recursive:true,force:true});}
}
describe('approved media paths',()=>{
 it('requires an explicit media root',async()=>{assert.equal(typeof api.PathGuard,'function');await assert.rejects(api.PathGuard.create([]));});
 it('opens approved Unicode names read-only',async()=>fixture(async root=>{const file=join(root,'촬영 본.wav');await writeFile(file,'abc');const g=await api.PathGuard.create([root]);const opened=await g.open(file);try{assert.equal((await opened.handle.readFile()).toString(),'abc');await assert.rejects(opened.handle.writeFile('changed'));}finally{await opened.handle.close();}}));
 for(const kind of ['relative','url','traversal','symlink','directory','missing','nul'] as const) it(`rejects ${kind}`,async()=>fixture(async(root,outside)=>{
   const g=await api.PathGuard.create([root]);await symlink(outside,join(root,'link.wav'));
   const input={relative:'file.wav',url:'https://example.com/a.wav',traversal:join(root,'..','private.txt'),symlink:join(root,'link.wav'),directory:root,missing:join(root,'gone.wav'),nul:join(root,'x\0.wav')}[kind];
   await assert.rejects(g.open(input));
 }));
 it('detects a changed registered revision',async()=>fixture(async root=>{
  const file=join(root,'a.wav');await writeFile(file,'one');const g=await api.PathGuard.create([root]);const a=await g.open(file);await a.handle.close();await writeFile(file,'changed-content');await assert.rejects(g.open(file,a.revision),{code:'MEDIA_CHANGED'});
 }));
});
