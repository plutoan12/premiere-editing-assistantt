// Build a staged combined panel without altering the existing transcript panel sources.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),flavor=process.argv[2]??'helper';
if(!['helper','hybrid'].includes(flavor))throw Error('Expected helper or hybrid');
const hybrid=flavor==='hybrid',out=path.join(root,'dist',`premiere-rough-${flavor}`),source=path.join(root,'apps/premiere-panel');
let addon;
if(hybrid){
 if(process.platform!=='darwin')throw Error('Hybrid staging requires macOS binary validation');
 addon=process.env.PEA_UXP_ADDON;if(!addon||!existsSync(addon))throw Error('PEA_UXP_ADDON must point to a real SDK-built .uxpaddon');
 const magic=readFileSync(addon).subarray(0,4).toString('hex');if(!['cffaedfe','feedfacf','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(magic))throw Error('Not a Mach-O addon');
}
mkdirSync(out,{recursive:true});
for(const file of ['main.js','index.html','style.css'])cpSync(path.join(source,file),path.join(out,file));
const manifest=JSON.parse(readFileSync(path.join(source,'manifest.json'),'utf8'));
manifest.id+=`.rough-${flavor}`;manifest.name=`PEA Rough Cut (${flavor})`;manifest.version='0.2.0';
if(hybrid){manifest.manifestVersion=6;manifest.host.minVersion='26.2.0';manifest.addon={name:'pea-media.uxpaddon'};manifest.requiredPermissions.enableAddon=true;
 const arch=process.env.PEA_ADDON_ARCH??process.arch;if(!['arm64','x64'].includes(arch))throw Error('Unsupported addon architecture');
 const dir=path.join(out,'mac',arch);mkdirSync(dir,{recursive:true});cpSync(addon,path.join(dir,'pea-media.uxpaddon'));
}
writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
let main=readFileSync(path.join(out,'main.js'),'utf8');const anchor='listenersInstalled = true;';if(main.split(anchor).length!==2)throw Error('Premiere panel entrypoint changed; reconcile integration');
main=main.replace('setDisabled("transcribe", false);\n}', 'setDisabled("transcribe", health.capabilities?.transcription === false);\n}');
main=main.replace(anchor,anchor+'\n        require("./rough-cut.js").install({ppro:require("premierepro"),fs,getBootstrap:()=>session,loadNative:()=>require("pea-media.uxpaddon")});');writeFileSync(path.join(out,'main.js'),main);
let html=readFileSync(path.join(out,'index.html'),'utf8');if(html.split('</main>').length!==2)throw Error('Panel DOM entrypoint changed');
html=html.replace('</main>',`<hr><section><h2>Rough Cut · 검토 후 적용</h2>
<p>프로젝트 패널에서 원본 MOV/MP4 하나를 선택해. 120초 이하, 고정 프레임률, 모노·스테레오 파일만 지원해.</p>
<p>원본 파일 전체를 분석해. 기존 타임라인의 편집·효과·클립 In/Out은 복사하지 않아. 먼저 프로젝트 사본을 저장해.</p>
<p id="rough-status"></p><span id="rough-progress"></span>
<button id="rough-analyze">선택한 원본 분석</button><button id="rough-cancel" disabled>분석 취소</button>
<div id="rough-candidates"></div><button id="rough-preview" disabled>편집 계획 검토</button><button id="rough-apply" disabled>새 러프 시퀀스 생성</button>
<p>미확정 후보는 유지돼. 적용 후 직접 재생 검수가 필요해. 가져오기 실패 후에는 프로젝트를 확인하기 전 다시 적용하지 마.</p></section></main>`);writeFileSync(path.join(out,'index.html'),html);
const require=createRequire(path.join(root,'apps/rough-cut-panel/package.json'));
await require('esbuild').build({entryPoints:[path.join(root,'apps/rough-cut-panel/src/ui.ts')],bundle:true,platform:'browser',format:'cjs',target:'es2022',outfile:path.join(out,'rough-cut.js'),define:{PEA_HYBRID:String(hybrid)},external:['uxp','premierepro','pea-media.uxpaddon'],logLevel:'info'});
console.log(`Staged plugin: ${out}. This is not a CCX and does not establish Premiere host acceptance.`);
