import { test } from "vitest";
import assert from 'node:assert/strict';
import { createPremiereHost, validateInterpretation } from './host.js';
function fixture(){
 let items:any[]=[{getId:()=> 'clip'}], imported=0;
 const interpretation={getFrameRate:()=>24,getPixelAspectRatio:()=>1,getFieldType:()=>0,FIELD_TYPE_DEFAULT:0,FIELD_TYPE_PROGRESSIVE:1,getRemovePullDown:()=>false,getInputLUTID:()=>''};
 const clip={getMediaFilePath:async()=>'/source.mov',isOffline:async()=>false,isMergedClip:async()=>false,isMulticamClip:async()=>false,isSequence:async()=>false,hasProxy:async()=>false,getFootageInterpretation:async()=>interpretation};
 const seqs:any[]=[];const p={guid:{toString:()=> 'project'},path:'/project.prproj',getSequences:async()=>seqs,getActiveSequence:async()=>null,getRootItem:async()=>({root:true}),importFiles:async(paths:string[],ui:boolean,root:any,stills:boolean)=>{assert.deepEqual(paths,['/data/p.xml']);assert.equal(ui,true);assert.equal(root.root,true);assert.equal(stills,false);imported++;seqs.push({guid:{toString:()=> 'new'},name:'Rough',getEndTime:async()=>({ticks:'1'})});return true;}};
 const ppro={Project:{getActiveProject:async()=>p},ProjectUtils:{getSelection:async()=>({getItems:async()=>items})},ClipProjectItem:{cast:()=>clip}};
 const fs={getDataFolder:async()=>({createFile:async(name:string,options:any)=>{assert.equal(options.overwrite,false);return{nativePath:'/data/p.xml',write:async()=>{}};}})};
 return {ppro,fs,clip,interpretation,p,setItems:(x:any[])=>items=x,count:()=>imported};
}
test('real host boundary calls documented importFiles shape and identifies only the new sequence',async()=>{
 const f=fixture(),h=createPremiereHost(f.ppro,f.fs);const s=await h.snapshot();assert.equal(s.clipId,'clip');const path=await h.writeXml('<x/>','p');assert(await h.importXml(path,s,'Rough'));assert.equal(f.count(),1);
});
test('host rejects multi-selection, offline, nested and proxy sources',async()=>{
 const f=fixture(),h=createPremiereHost(f.ppro,f.fs);f.setItems([]);await assert.rejects(()=>h.snapshot(),/one/);f.setItems([{getId:()=> 'clip'}]);f.clip.isSequence=async()=>true;await assert.rejects(()=>h.snapshot(),/source/);f.clip.isSequence=async()=>false;f.clip.hasProxy=async()=>true;await assert.rejects(()=>h.snapshot(),/proxy/);
});
test('source interpretation must match probed rate without retime, pulldown or aspect override',()=>{
 const base={fps:24,par:1,pulldown:false,field:0,defaultField:0,progressiveField:1,lut:''};const m={frameRate:{numerator:24,denominator:1}} as any;
 assert.doesNotThrow(()=>validateInterpretation(JSON.stringify(base),m));for(const patch of[{fps:25},{par:2},{pulldown:true},{field:2},{lut:'custom'}])assert.throws(()=>validateInterpretation(JSON.stringify({...base,...patch}),m));
});
