/* Small static CommonJS bundler for this source-only workspace. No eval or runtime downloads. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{builtinModules}=require('node:module');
const root=path.resolve(__dirname,'..');
const packages={};
for(const base of ['apps','packages','adapters'])for(const name of fs.readdirSync(path.join(root,base))){
  const dir=path.join(root,base,name),file=path.join(dir,'package.json');
  if(fs.existsSync(file))packages[JSON.parse(fs.readFileSync(file,'utf8')).name]=dir;
}
function resolveImport(from,name){
  let dest;
  if(name.startsWith('.'))dest=path.resolve(path.dirname(from),name);
  else {
    const key=Object.keys(packages).sort((a,b)=>b.length-a.length).find(k=>name===k||name.startsWith(k+'/'));
    if(!key)return null;
    const dir=packages[key],pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
    const exp=name===key?'.':'.'+name.slice(key.length);
    if(!pkg.exports||typeof pkg.exports[exp]!=='string')throw new Error('Missing workspace export: '+name);
    dest=path.resolve(dir,pkg.exports[exp]);
  }
  if(!dest.startsWith(root+path.sep))throw new Error('Import escapes repository');
  if(dest.endsWith('.js')&&fs.existsSync(dest.slice(0,-3)+'.ts'))dest=dest.slice(0,-3)+'.ts';
  if(!fs.existsSync(dest))throw new Error('Missing source: '+dest);
  return dest;
}
function bundle(entry,output,external){
  const ids=new Map(),modules=[],sources=[],externals=new Set();
  function visit(file){
    if(ids.has(file))return ids.get(file);
    const id=modules.length;ids.set(file,id);modules.push('');sources.push(path.relative(root,file));
    const emitted=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}});
    let code=emitted.outputText;
    const ast=ts.createSourceFile('module.js',code,ts.ScriptTarget.ES2020,true,ts.ScriptKind.JS),patches=[];
    function scan(node){
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='require'){
        const a=node.arguments[0];if(node.arguments.length!==1||!ts.isStringLiteral(a))throw new Error('Dynamic require prohibited');
        const name=a.text,target=resolveImport(file,name);
        if(target)patches.push([node.getStart(ast),node.end,`__load(${visit(target)})`]);
        else{if(!external(name))throw new Error('Unsupported runtime external '+name);externals.add(name);}
      }
      ts.forEachChild(node,scan);
    }
    scan(ast);patches.sort((a,b)=>b[0]-a[0]).forEach(([start,end,value])=>{code=code.slice(0,start)+value+code.slice(end);});
    modules[id]=`function(require,module,exports,__load){\n${code}\n}`;return id;
  }
  const entryId=visit(path.join(root,entry));
  const text=`/* PEA Sync development bundle 0.2.0 */\n(function(nativeRequire){\nconst modules=[${modules.join(',\n')}],cache={};\nfunction load(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;modules[id](nativeRequire,m,m.exports,load);return m.exports;}\nload(${entryId});\n})(require);\n`;
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,text);
  return{sources,externals:[...externals],bytes:Buffer.byteLength(text)};
}
const out=path.join(root,'dist');
const panel=bundle('apps/premiere-panel/src/main.ts',path.join(out,'pea-sync-panel/main.js'),n=>['premierepro','uxp'].includes(n));
for(const name of ['manifest.json','index.html','style.css'])fs.copyFileSync(path.join(root,'apps/premiere-panel',name),path.join(out,'pea-sync-panel',name));
const helper=bundle('apps/native-helper/src/file-cli.ts',path.join(out,'pea-sync-helper/cli.cjs'),n=>builtinModules.includes(n)||builtinModules.includes(n.replace(/^node:/,'')));
fs.writeFileSync(path.join(out,'bundle-audit.json'),JSON.stringify({panel,helper},null,2));
console.log(`Built panel (${panel.bytes} bytes) and helper (${helper.bytes} bytes); externals: ${panel.externals.join(', ')}`);
fs.copyFileSync(path.join(root,'scripts/start-helper.command'),path.join(out,'start-helper.command'));
fs.chmodSync(path.join(out,'start-helper.command'),0o755);
fs.copyFileSync(path.join(root,'apps/premiere-panel/README.md'),path.join(out,'README.md'));
