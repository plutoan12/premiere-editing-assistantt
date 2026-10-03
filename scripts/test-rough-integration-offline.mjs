// Targeted runtime verification. Whole-repository typecheck is a separate CI gate.
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
let ts;try{ts=require('typescript');}catch{ts=require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=mkdtempSync(path.join(tmpdir(),'pea-rough-integration-'));
const units={'@pea/rough-cut':'packages/rough-cut','@pea/rough-media':'packages/rough-media','@pea/premiere-rough-cut':'adapters/premiere-rough-cut','@pea/rough-cut-panel':'apps/rough-cut-panel'};
const tests=[];
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name)):[path.join(dir,x.name)]);}
try{
 writeFileSync(path.join(out,'package.json'),'{"type":"module"}');
 for(const rel of [...Object.values(units),'apps/native-helper']){
  const dir=path.join(root,rel,'src');if(!existsSync(dir))continue;
  for(const file of walk(dir).filter(x=>x.endsWith('.ts')&&!x.endsWith('.d.ts'))){
   // The existing transcript server is checked in full CI, not against local stubs.
   if(rel==='apps/native-helper'&&!path.basename(file).startsWith('audio-'))continue;
   let text=readFileSync(file,'utf8');
   if(file.endsWith('.test.ts')){
    if(!/import \{ test \} from ["']vitest["'];/.test(text))throw Error('Unsupported registration '+file);
    text=text.replace(/import \{ test \} from ["']vitest["'];/,'import { test } from "node:test";');
   }
   const dest=path.join(out,path.relative(root,file)).replace(/\.ts$/,'.js');
   for(const [alias,target]of Object.entries({...units,'@pea/rough-media/wire':'packages/rough-media#types','@pea/rough-media/client':'packages/rough-media#client'})){
    let local=path.relative(path.dirname(dest),path.join(out,target.split('#')[0],'src', (target.split('#')[1]||'index')+'.js'));if(!local.startsWith('.'))local='./'+local;
    text=text.replaceAll(`'${alias}'`,`'${local}'`).replaceAll(`"${alias}"`,`"${local}"`);
   }
   const result=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
   if(result.diagnostics?.some(x=>x.category===ts.DiagnosticCategory.Error))throw Error('TypeScript syntax '+file);
   mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,result.outputText);
   if(file.endsWith('.test.ts'))tests.push(dest);
  }
 }
 const args=process.argv.slice(2);const chosen=tests.filter(f=>!args.length||args.some(s=>f.includes(s)));
 if(!chosen.length)throw Error('No test files');
 const result=spawnSync(process.execPath,['--test',...chosen],{stdio:'inherit',env:{...process.env,PEA_SOURCE_ROOT:root}});
 process.exitCode=result.status??1;
}finally{rmSync(out,{recursive:true,force:true});}
