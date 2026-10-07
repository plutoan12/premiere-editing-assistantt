import { mountSyncPanel } from './ui.js';
import type { PremiereModuleLike } from './premiere-host.js';
import type { UxpStorageLike } from './ui.js';
declare function require(name: string): unknown;
try {
  // These modules are resolved by Adobe UXP at runtime, not bundled Node shims.
  const ppro = require('premierepro') as PremiereModuleLike;
  const uxp = require('uxp') as {storage:UxpStorageLike;entrypoints:{setup(value:unknown):void}};
  let panel:ReturnType<typeof mountSyncPanel>|undefined;
  const show=()=>{if(!panel)panel=mountSyncPanel(ppro,uxp.storage,document);};
  uxp.entrypoints.setup({panels:{'pea-sync':{create(){},show,destroy(){panel?.destroy();panel=undefined;}}}});
} catch {
  const status=document.getElementById('status');
  if(status)status.textContent='Premiere UXP 부팅 실패. 브라우저가 아니라 Premiere 25.6+의 UXP Developer Tool에서 이 manifest를 불러와줘.';
}
