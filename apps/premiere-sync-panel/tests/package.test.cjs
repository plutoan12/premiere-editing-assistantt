const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('ships an analysis-only panel with narrowly scoped permissions and all entrypoint files',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 assert.equal(manifest.host.app,'premierepro');assert.equal(manifest.manifestVersion,5);assert.equal(manifest.requiredPermissions.localFileSystem,'request');
 assert.deepEqual(manifest.requiredPermissions.network.domains,['https://127.0.0.1']);
 const html=fs.readFileSync(path.join(root,manifest.main),'utf8');
 for(const id of ['connect','capture','reference','run','cancel','retry','export','status','sources','result'])assert.ok(html.includes(`id="${id}"`),id);
 assert.ok(!/id="apply"/.test(html));
 for(const name of ['main.js','client.js','controller.js','selection.js','style.css'])assert.ok(fs.existsSync(path.join(root,name)),name);
 const main=fs.readFileSync(path.join(root,'main.js'),'utf8');assert.ok(!/importFiles|executeTransaction|createSequence/.test(main));
});
