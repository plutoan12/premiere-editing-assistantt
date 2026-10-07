'use strict';
const {readFile,mkdir,copyFile,writeFile}=require('node:fs/promises');
const {join}=require('node:path');
const ts=require('typescript');
async function build(){
  const output=join(__dirname,'dist');await mkdir(output,{recursive:true});
  for(const file of ['manifest.json','index.html','main.js'])await copyFile(join(__dirname,file),join(output,file));
  const source=await readFile(join(__dirname,'../../adapters/premiere/src/uxp-mogrt.ts'),'utf8');
  const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true});
  if(result.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('UXP_TRANSPILE_FAILED');
  await writeFile(join(output,'uxp-mogrt.js'),result.outputText);
  console.log('Built development UXP panel: apps/premiere-graphics-panel/dist/manifest.json');
}
build().catch(error=>{console.error(error.message);process.exitCode=1;});
