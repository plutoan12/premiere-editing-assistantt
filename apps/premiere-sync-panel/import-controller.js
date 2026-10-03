'use strict';
/** UXP host boundary. Tests use a host double, not an actual Premiere session. */
function createImportController(host) {
  let selection=null,busy=false,attempted=false;
  function inspectXml(text){
    if(typeof text!=='string'||text.length>16*1024*1024||!text.includes('PEA_SYNC_XML_V1')||!/<xmeml\s+version="5"\s*>/.test(text))throw new Error('Unsupported sync XML format');
    if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('External XML declarations are not accepted');
    if((text.match(/<sequence(?:\s|>)/g)||[]).length!==1)throw new Error('XML must describe one new sequence');
    const updates=[...text.matchAll(/<updatebehavior>([^<]+)<\/updatebehavior>/g)].map(m=>m[1]);
    if(updates.length!==1||updates[0]!=='add')throw new Error('XML must only add a new sequence');
  }
  return {
    async inspect(file){
      if(busy)throw new Error('Import in progress');selection=null;attempted=false;
      if(!file||typeof file.read!=='function'||typeof file.nativePath!=='string'||!file.nativePath)throw new Error('Select a local XML file');
      const text=await file.read();inspectXml(text);selection={file,text};
      return {filename:file.name||file.nativePath,sequenceCount:1,clipItems:(text.match(/<clipitem\s/g)||[]).length};
    },
    async apply(approved){
      if(approved!==true)throw new Error('Explicit approval is required');
      if(busy)throw new Error('Import in progress');
      if(attempted)throw new Error('This selection was already attempted; inspect the project before selecting again');
      if(!selection)throw new Error('Select and preview a sync XML first');
      busy=true;
      try{
        const current=await selection.file.read();if(current!==selection.text)throw new Error('XML changed after preview; select it again');
        inspectXml(current);
        if(!host.Project||typeof host.Project.getActiveProject!=='function')throw new Error('Premiere UXP Project API is unavailable');
        const project=await host.Project.getActiveProject();if(!project)throw new Error('Open a Premiere project first');
        if(typeof project.importFiles!=='function'||typeof project.getSequences!=='function'||typeof project.getRootItem!=='function')throw new Error('Required project import capabilities are unavailable');
        const before=await project.getSequences(),bin=await project.getRootItem();
        attempted=true;
        const imported=await project.importFiles([selection.file.nativePath],false,bin,false);
        if(!imported)throw new Error('Premiere import failed; check the project for partial changes before retrying');
        const after=await project.getSequences(),added=after.length-before.length;
        if(added<1)throw new Error('Premiere did not report a new sequence; inspect the import results');
        return {status:'imported',addedSequences:added,projectName:project.name,saved:false};
      }finally{busy=false;}
    }
  };
}
module.exports={createImportController};
