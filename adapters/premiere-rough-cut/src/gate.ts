import type { SequencePlan } from '@pea/core';
import type { MediaDescriptor } from '@pea/rough-media/wire';
import { renderRoughXml } from './xml.js';
export interface HostSnapshot { projectId:string; projectPath:string; clipId:string; sourcePath:string; interpretation:string; sequenceState:string; }
export interface ApplyHost {
  snapshot():Promise<HostSnapshot>;
  writeXml(xml:string,planId:string):Promise<string>;
  importXml(path:string,snapshot:HostSnapshot,name:string):Promise<boolean>;
}
export interface Preview { readonly id:string; readonly name:string; readonly xml:string; readonly cutCount:number; }
export function createApplyGate(host:ApplyHost) {
  let counter=0, busy=false;
  let active:{preview:Preview;snapshot:HostSnapshot;planId:string;consumed:boolean}|undefined;
  const used=new Set<string>();
  const same=(a:HostSnapshot,b:HostSnapshot)=>JSON.stringify(a)===JSON.stringify(b);
  return {
    invalidate(){if(busy)throw new Error('apply busy');active=undefined;},
    async preview(plan:SequencePlan,media:MediaDescriptor,clipId:string):Promise<Preview>{
      if(busy||used.has(plan.id))throw new Error('plan consumed or apply busy');
      const xml=renderRoughXml(plan,media,clipId),snapshot={...await host.snapshot()};
      if(!snapshot.projectId||snapshot.clipId!==clipId||snapshot.sourcePath!==media.path)throw new Error('stale selected source');
      const preview=Object.freeze({id:`approval-${++counter}`,name:plan.name,xml,cutCount:plan.decisions.length});
      active={preview,snapshot,planId:plan.id,consumed:false};return preview;
    },
    async apply(id:string):Promise<void>{
      if(busy)throw new Error('apply busy');
      const a=active;if(!a||a.consumed||id!==a.preview.id)throw new Error('approval missing or consumed');
      busy=true;a.consumed=true;
      try{
        if(!same(a.snapshot,await host.snapshot()))throw new Error('stale preview: review again');
        const path=await host.writeXml(a.preview.xml,a.planId);
        if(!same(a.snapshot,await host.snapshot()))throw new Error('stale preview after XML write');
        // No automatic retry or deletion after the host import can have partially succeeded.
        used.add(a.planId);
        try { if(!await host.importXml(path,a.snapshot,a.preview.name))throw new Error('host rejected import'); }
        catch { throw new Error('Import may be partial; inspect the project before retrying with a new analysis.'); }
      }finally{busy=false;}
    },
  };
}
