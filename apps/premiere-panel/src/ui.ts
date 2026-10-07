import { connectFileHelper } from '@pea/sync-helper-client/file';
import type { UxpFolder } from '@pea/sync-helper-client/file';
import { createPremiereUxpHost, readPremiereSelection } from './premiere-host.js';
import type { PremiereModuleLike, SelectedClip } from './premiere-host.js';
import { SyncController } from './sync-controller.js';
import type { ControllerView } from './sync-controller.js';
export interface UxpStorageLike { localFileSystem: {
  getFolder():Promise<UxpFolder|null>;
  getFileForSaving(name:string,options:{types:string[]}):Promise<{write(value:string):Promise<unknown>}|null>;
} }
type Control=HTMLElement&{value:string;selectedIndex:number;checked:boolean;disabled:boolean};
/** Plain UXP/Spectrum controls: no browser framework, CDN, or remote code. */
export function mountSyncPanel(ppro:PremiereModuleLike,storage:UxpStorageLike,doc:Document):{destroy():void}{
  const element=(id:string):Control=>{const e=doc.getElementById(id);if(!e)throw new Error(`Missing panel element: ${id}`);return e as Control;};
  const cleanup:Array<()=>void>=[];let connected=false,busy=false,disposed=false,clips:SelectedClip[]=[];
  function error(e:unknown):void{if(!disposed)element('status').textContent=e instanceof Error?e.message:'작업 실패';}
  const c=new SyncController({readSelection:()=>readPremiereSelection(ppro),createHost:bindings=>createPremiereUxpHost(ppro,bindings),onChange:render});
  function render(v:ControllerView):void{
    if(disposed)return;
    element('status').textContent=v.message;
    const locked=busy||v.phase==='applying'||v.phase==='analyzing';
    for(const key of ['connect','selection','reference','mode','start','duration','sequence-name'])element(key).disabled=locked;
    element('analyze').disabled=locked||!connected||clips.length<2;
    element('cancel').disabled=v.phase!=='analyzing';
    element('dry-run').disabled=locked||!['review','dry-run'].includes(v.phase);
    element('apply').disabled=locked||v.phase!=='dry-run'||!element('test-copy').checked;
    element('export-report').disabled=locked||!v.report;
    const results=element('results');while(results.firstChild)results.removeChild(results.firstChild);
    for(const row of v.rows){const p=doc.createElement('p'),name=clips.find(s=>s.clipId===row.clipId)?.name??row.clipId;
      p.textContent=`${name} · ${row.status==='matched'?'매칭':'검수 필요'} · 유사도 ${row.score.toFixed(3)}\n${row.reason}${row.offsetSeconds===undefined?'':` · ${row.offsetSeconds.toFixed(6)}초`}`;results.appendChild(p);}
    element('plan').textContent=v.plan?[
      `새 시퀀스: ${v.plan.sequenceName}`,
      ...v.plan.operations.map(o=>`${clips.find(s=>s.clipId===o.clipId)?.name??o.clipId}: 트랙 ${o.trackIndex+1}, ${o.startSeconds.toFixed(6)}초 (프레임 반올림 ${ (o.quantizationErrorSeconds*1000).toFixed(3)} ms)`),
      ...v.plan.warnings,
    ].join('\n'):v.report?JSON.stringify(v.report,null,2):'';
  }
  function on(id:string,type:string,action:()=>unknown):void{
    const listener=()=>{try{const result=action();if(result&&typeof (result as Promise<unknown>).catch==='function')void (result as Promise<unknown>).catch(error);}catch(e){error(e);}};
    element(id).addEventListener(type,listener);cleanup.push(()=>element(id).removeEventListener(type,listener));
  }
  async function operation(action:()=>Promise<void>):Promise<void>{busy=true;render(c.view);try{await action();}finally{busy=false;render(c.view);}}
  on('connect','click',()=>operation(async()=>{
    const folder=await storage.localFileSystem.getFolder();if(!folder)return;
    const helper=await connectFileHelper(folder,{timeoutMs:120000});if(disposed)return;c.connect(helper);connected=true;
  }));
  on('selection','click',()=>operation(async()=>{
    c.invalidate();const s=await readPremiereSelection(ppro);if(disposed)return;clips=s.clips;
    const menu=element('reference-options');while(menu.firstChild)menu.removeChild(menu.firstChild);
    for(let i=0;i<clips.length;i++){const item=doc.createElement('sp-menu-item');item.textContent=clips[i].name;if(i===0)item.setAttribute('selected','');menu.appendChild(item);}
    element('reference').selectedIndex=0;
    element('selection-info').textContent=`${clips.length}개 클립 · 기준 시퀀스 ${s.template.name} · ${(s.frameRate.numerator/s.frameRate.denominator).toFixed(3)} fps`;
  }));
  on('analyze','click',()=>c.analyze({referenceClipId:clips[element('reference').selectedIndex]?.clipId??'',
    mode:element('mode').selectedIndex===1?'playback':'audio',sampleRate:8000,startSeconds:Number(element('start').value),durationSeconds:Number(element('duration').value)}));
  on('cancel','click',()=>c.cancel());
  on('dry-run','click',()=>operation(async()=>{element('test-copy').checked=false;await c.dryRun(element('sequence-name').value);}));
  on('test-copy','change',()=>render(c.view));
  on('apply','click',()=>c.apply(element('test-copy').checked));
  on('export-report','click',()=>operation(async()=>{const file=await storage.localFileSystem.getFileForSaving('pea-sync-acceptance.json',{types:['json']});
    if(file)await file.write(JSON.stringify({build:'0.2.0',kind:'premiere-native-readback',...c.view},null,2));}));
  for(const key of ['reference','mode','start','duration','sequence-name'])on(key,'change',()=>{element('test-copy').checked=false;c.invalidate();});
  render(c.view);
  return{destroy(){disposed=true;c.cancel();cleanup.forEach(fn=>fn());}};
}
