import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { buildTextDraft } from './preset.mjs';
const require = createRequire(import.meta.url);
let directory, native;
before(async () => {
  // Use the project's existing TypeScript dependency and actual adapter sources.
  // No copies of validator behavior, Adobe mocks, or SDK calls are involved.
  const ts = require('typescript');
  directory = await mkdtemp(join(tmpdir(), 'pea-juno-contract-'));
  await writeFile(join(directory,'package.json'),'{"type":"module"}');
  for (const name of ['uxp-mogrt','uxp-mogrt-text']) {
    const source = await readFile(new URL(`../../adapters/premiere/src/${name}.ts`,import.meta.url),'utf8');
    const result = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
    assert.equal((result.diagnostics ?? []).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
    await writeFile(join(directory,`${name}.js`),result.outputText);
  }
  native = await import(pathToFileURL(join(directory,'uxp-mogrt-text.js')).href);
});
after(async () => { if(directory) await rm(directory,{recursive:true,force:true}); });
const binding={templateId:'fixture-only',templateVersion:'1.0.0',templatePath:'/tmp/fixture-only.mogrt'};
const timing={width:1920,height:1080,fpsNumerator:30000,fpsDenominator:1001,startFrame:60,durationFrames:90};
test('actual PEA adapter accepts the Korean multiline draft',()=>{
  const draft=buildTextDraft('한글 자막\n👩🏽‍💻 두 번째 줄',binding,timing);
  assert.deepEqual(native.validateMogrtTextDraft(draft),draft);
});
test('actual PEA adapter accepts portrait frame-exact drafts',()=>{
  const draft=buildTextDraft('세로 자막',binding,{...timing,width:1080,height:1920});
  assert.deepEqual(native.validateMogrtTextDraft(draft),draft);
});
test('existing native text-write release gate remains closed',()=>{
  assert.equal(native.MOGRT_TEXT_WRITE_VERIFIED,false);
});
