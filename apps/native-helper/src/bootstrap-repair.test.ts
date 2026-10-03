import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {readFile,stat,access,writeFile,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import * as bootstrap from './bootstrap.js';
describe('private helper bootstrap',()=>{
 it('stores the token only in a private file and removes it after shutdown',async()=>{
  assert.equal(typeof bootstrap.startHelperSession,'function');const session=await bootstrap.startHelperSession();
  try{const config=JSON.parse(await readFile(session.sessionFile,'utf8'));assert.ok(config.sessionToken.length>=32);assert.equal((await stat(session.sessionFile)).mode&0o777,0o600);assert.equal((await stat(dirname(session.sessionFile))).mode&0o777,0o700);const health=await fetch(config.address+'/health');assert.equal(health.status,200);assert.ok(!(await health.text()).includes(config.sessionToken))}finally{await session.close()}
  await assert.rejects(access(session.sessionFile));
 });
 it('does not remove unrelated files placed in its session directory',async()=>{
  assert.equal(typeof bootstrap.startHelperSession,'function');const session=await bootstrap.startHelperSession();const dir=dirname(session.sessionFile),note=join(dir,'user-note.txt');await writeFile(note,'keep');await session.close();assert.equal(await readFile(note,'utf8'),'keep');await rm(dir,{recursive:true,force:true});
 });
});
