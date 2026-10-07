import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
const root=process.env.PEA_REPO_ROOT??resolve(process.cwd(),'../..');
test('manifest uses a real Premiere panel and only user-granted folder access',()=>{
  const p=resolve(root,'apps/premiere-panel/manifest.json');assert.ok(existsSync(p),'missing manifest');
  const m=JSON.parse(readFileSync(p,'utf8'));assert.equal(m.manifestVersion,5);assert.equal(m.host.app,'premierepro');
  assert.equal(m.entrypoints[0].id,'pea-sync');assert.equal(m.main,'index.html');
  assert.deepEqual(m.requiredPermissions,{localFileSystem:'request'});
});
test('built bundle loads premierepro and uxp, registers matching entrypoint without Node modules',()=>{
  const p=resolve(root,'dist/pea-sync-panel/main.js');assert.ok(existsSync(p),'missing build');
  const native:string[]=[];let registrations:any;
  runInNewContext(readFileSync(p,'utf8'),{require:(name:string)=>{
    native.push(name);if(name==='premierepro')return{};if(name==='uxp')return{entrypoints:{setup:(r:unknown)=>{registrations=r;}},storage:{}};throw new Error('Unexpected external '+name);
  },document:{getElementById:()=>({textContent:''})},console:{error:()=>{}}});
  assert.deepEqual(native,['premierepro','uxp']);assert.equal(typeof registrations.panels['pea-sync'].show,'function');
});
test('missing Premiere runtime renders an explicit boot error instead of a blank panel',()=>{
  const p=resolve(root,'dist/pea-sync-panel/main.js');assert.ok(existsSync(p),'missing build');const status={textContent:''};
  runInNewContext(readFileSync(p,'utf8'),{require:()=>{throw new Error('module absent');},document:{getElementById:()=>status},console:{error:()=>{}}});
  assert.match(status.textContent,/Premiere/);
});
