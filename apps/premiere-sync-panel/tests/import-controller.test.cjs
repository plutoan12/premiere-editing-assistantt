const {test}=require('node:test');const assert=require('node:assert/strict');
const api=require('../import-controller.js');
const xml='<?xml version="1.0"?><xmeml version="5"><!-- PEA_SYNC_XML_V1 --><sequence><name>Scene</name><updatebehavior>add</updatebehavior></sequence></xmeml>';
function fixture(){let content=xml;const state={imports:0,sequences:[],root:{id:'root'},saveCalls:0};
  const file={nativePath:'/tmp/sync.xml',name:'sync.xml',read:async()=>content};
  const project={name:'Test project',getRootItem:async()=>state.root,getSequences:async()=>[...state.sequences],
    importFiles:async(paths,suppressUI,targetBin,asNumberedStills)=>{assert.deepEqual(paths,[file.nativePath]);assert.equal(suppressUI,false);assert.equal(targetBin,state.root);assert.equal(asNumberedStills,false);state.imports++;state.sequences.push({name:'Scene'});return true;},save:()=>state.saveCalls++};
  const host={Project:{getActiveProject:async()=>project}};
  return {state,file,project,host,change:()=>{content=xml+' ';}};}
test('explicit approval is mandatory and no project writes occur without it',async()=>{
  const f=fixture(),c=api.createImportController(f.host);await c.inspect(f.file);await assert.rejects(()=>c.apply(false),/approval/);assert.equal(f.state.imports,0);
});
test('approved import adds a sequence but does not save or change existing sequence',async()=>{
  const f=fixture(),c=api.createImportController(f.host);f.state.sequences.push({name:'Existing'});await c.inspect(f.file);const r=await c.apply(true);
  assert.equal(r.addedSequences,1);assert.equal(f.state.sequences[0].name,'Existing');assert.equal(f.state.saveCalls,0);assert.equal(f.state.imports,1);
  await assert.rejects(()=>c.apply(true),/already/);
});
test('changed XML after preview is blocked before import',async()=>{
  const f=fixture(),c=api.createImportController(f.host);await c.inspect(f.file);f.change();await assert.rejects(()=>c.apply(true),/changed/);assert.equal(f.state.imports,0);
});
test('no active project and host import failure are visible errors',async()=>{
  const f=fixture();let c=api.createImportController({Project:{getActiveProject:async()=>null}});await c.inspect(f.file);await assert.rejects(()=>c.apply(true),/project/);
  f.project.importFiles=async()=>false;c=api.createImportController(f.host);await c.inspect(f.file);await assert.rejects(()=>c.apply(true),/import/);
});
test('XML format markers, external entities and replacement operations are rejected',async()=>{
  const f=fixture(),c=api.createImportController(f.host);
  for(const text of ['<fcpxml/>',xml.replace('add','replaceiffound'),xml+'<!DOCTYPE xmeml SYSTEM "file:///etc/passwd">'])
    await assert.rejects(()=>c.inspect({...f.file,read:async()=>text}),/XML|format|add/);
});
test('a true host response without a new sequence is not reported as successful',async()=>{
  const f=fixture(),c=api.createImportController(f.host);f.project.importFiles=async()=>true;await c.inspect(f.file);await assert.rejects(()=>c.apply(true),/sequence/);
});
test('double-clicks cannot concurrently import the same selection',async()=>{
  const f=fixture(),original=f.project.importFiles;let release;
  f.project.importFiles=async(...args)=>{await new Promise(r=>{release=r;});return original(...args);};
  const c=api.createImportController(f.host);await c.inspect(f.file);const first=c.apply(true);
  await assert.rejects(()=>c.apply(true),/progress/);await new Promise(r=>setTimeout(r,0));release();await first;assert.equal(f.state.imports,1);
});
