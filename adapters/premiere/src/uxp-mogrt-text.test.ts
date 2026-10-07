import { describe, expect, it } from "vitest";
import * as host from "./index.js";

// Adobe's host is unavailable to Node. This double models detached typed values
// and synchronous locked transactions; 27.x host verification remains separate.
function fixture() {
  const state = { text: "원본", fontName: "NotoSansKR-Regular", fontSize: 48,
    allCaps: false, fauxBold: true, fauxItalic: false, smallCaps: false };
  const flags = { uniform: true, fontName: true, fontSize: true, varying: false };
  let locked = false, writes = 0;
  class TextValue {
    value = { ...state };
    getText() { return this.value.text; }
    getFontName() { return this.value.fontName; }
    getFontSize() { return this.value.fontSize; }
    getAllCaps() { return this.value.allCaps; }
    getFauxBold() { return this.value.fauxBold; }
    getFauxItalic() { return this.value.fauxItalic; }
    getSmallCaps() { return this.value.smallCaps; }
    isUniformStyling() { return flags.uniform; }
    isFontNameEditable() { return flags.fontName; }
    isFontSizeEditable() { return flags.fontSize; }
    setText(v: string) { this.value.text = v; return true; }
    setFontName(v: string) { this.value.fontName = v; return true; }
    setFontSize(v: number) { this.value.fontSize = v; return true; }
    setAllCaps(v: boolean) { this.value.allCaps = v; return true; }
    setFauxBold(v: boolean) { this.value.fauxBold = v; return true; }
    setFauxItalic(v: boolean) { this.value.fauxItalic = v; return true; }
    setSmallCaps(v: boolean) { this.value.smallCaps = v; return true; }
  }
  const param = { displayName: "Source Text", isTimeVarying: () => flags.varying,
    getStartValue: async (): Promise<unknown> => new TextValue(),
    createKeyframe: (v: TextValue) => v,
    createSetValueAction: (v: TextValue) => {
      if (!locked) throw Error("Action created outside locked access");
      return () => { writes++; Object.assign(state, v.value); };
    } };
  const component = { getMatchName: async () => "AE.ADBE Text", getParamCount: () => 1, getParam: () => param };
  const chain = { getComponentCount: () => 1, getComponentAtIndex: () => component };
  const item = { getName: async () => "Title", getStartTime: async () => ({ticks:"508540032000"}),
    getEndTime: async () => ({ticks:"762810048000"}), getProjectItem: async ():Promise<{getId():string}|null> => ({getId:()=>"asset"}),
    getComponentChain: async () => chain };
  const track = {getTrackItems:()=>[item]};
  const sequence = {guid:{toString:()=>"sequence"},getVideoTrack:async()=>track};
  const project = {guid:{toString:()=>"project"},getSequences:async()=>[sequence],
    lockedAccess:(fn:()=>void)=>{locked=true;try{fn();}finally{locked=false;}},
    executeTransaction:(fn:(c:{addAction:(a:unknown)=>boolean})=>void)=>{
      if(!locked)throw Error("Transaction outside locked access");
      const actions:unknown[]=[];fn({addAction:a=>{actions.push(a);return true;}});
      actions.forEach(a=>(a as ()=>void)());return true;
    } };
  const api = {MogrtText:TextValue,Project:{getActiveProject:async()=>project},Constants:{TrackItemType:{CLIP:1}}};
  const receipt = {status:"preview-created" as const,projectId:"project",sequenceId:"sequence",decisionId:"a",
    graphicsApplied:false as const,unapplied:["caption-text"],items:[{name:"Title",startTicks:"508540032000",endTicks:"762810048000"}]};
  return {api,receipt,state,flags,param,component,chain,item,track,sequence,project,TextValue,writes:()=>writes};
}

describe("editable MOGRT text boundary",()=>{
  it("detects an unsupported host without reading or changing a project",async()=>{
    const f=fixture();const api={...f.api,MogrtText:undefined};
    api.Project.getActiveProject=async()=>{throw Error("must not read project");};
    expect(await host.inspectPremiereMogrtText(api,f.receipt)).toMatchObject({status:"unsupported",targets:[]});
    expect(f.writes()).toBe(0);
  });
  it("edits only the selected text, preserves style flags, and verifies the resulting values",async()=>{
    const f=fixture(), inspection=await host.inspectPremiereMogrtText(f.api,f.receipt);
    expect(inspection).toMatchObject({status:"ready",targets:[{parameterName:"Source Text",before:{text:"원본",fauxBold:true}}]});
    const result=await host.applyPremiereMogrtText(f.api,inspection,0,{text:"안녕 👩‍👩‍👧‍👦\n두 줄",fontName:"NotoSansKR-Bold",fontSize:60});
    expect(result).toMatchObject({status:"text-updated",graphicsApplied:false,before:{text:"원본"},after:{text:"안녕 👩‍👩‍👧‍👦\n두 줄",fontName:"NotoSansKR-Bold",fontSize:60,fauxBold:true}});
    expect(f.state).toEqual({text:"안녕 👩‍👩‍👧‍👦\n두 줄",fontName:"NotoSansKR-Bold",fontSize:60,allCaps:false,fauxBold:true,fauxItalic:false,smallCaps:false});
    expect(f.writes()).toBe(1);
  });
  it.each(["mixed", "animated", "scalar", "unavailable"])("does not offer unsafe text targets: %s",async kind=>{
    const f=fixture();
    if(kind==="mixed")f.flags.uniform=false;
    if(kind==="animated")f.flags.varying=true;
    if(kind==="scalar")f.param.getStartValue=async()=>({value:{value:"text-like scalar"}});
    if(kind==="unavailable")f.param.getStartValue=async()=>null;
    expect(await host.inspectPremiereMogrtText(f.api,f.receipt)).toMatchObject({status:"no-editable-text",targets:[]});
    expect(f.writes()).toBe(0);
  });
  it("reports unavailable text on a native graphic without a project item",async()=>{
    const f=fixture();f.item.getProjectItem=async()=>null;f.param.getStartValue=async()=>null;
    expect(await host.inspectPremiereMogrtText(f.api,f.receipt)).toMatchObject({status:"no-editable-text",targets:[],
      skipped:[{code:"TEXT_VALUE_UNAVAILABLE"}]});
    expect(f.writes()).toBe(0);
  });
  it("edits typed text without a project item when live instance identity is stable",async()=>{
    const f=fixture();f.item.getProjectItem=async()=>null;
    const i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).toMatchObject({status:"text-updated"});
    expect(f.writes()).toBe(1);
  });
  it("rejects a replacement graphic even when both project items are null",async()=>{
    const f=fixture();f.item.getProjectItem=async()=>null;
    const i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    f.track.getTrackItems=()=>[{...f.item}];
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).toMatchObject({status:"blocked",code:"TEXT_TARGET_IDENTITY_CHANGED"});
    expect(f.writes()).toBe(0);
  });
  it.each([true,false])("rejects project-item presence changing after inspection: initially null %s",async initiallyNull=>{
    const f=fixture(),asset={getId:()=>"asset"};f.item.getProjectItem=async()=>initiallyNull?null:asset;
    const i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    f.item.getProjectItem=async()=>initiallyNull?asset:null;
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).toMatchObject({status:"blocked",code:"PREVIEW_ITEM_CHANGED"});
    expect(f.writes()).toBe(0);
  });
  it("enforces author font restrictions but permits text-only edits",async()=>{
    const f=fixture();f.flags.fontName=false;f.flags.fontSize=false;
    const i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new",fontSize:72})).toMatchObject({status:"blocked",code:"FONT_SIZE_LOCKED"});
    expect(f.writes()).toBe(0);
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).toMatchObject({status:"text-updated",after:{fontName:"NotoSansKR-Regular",fontSize:48}});
  });
  it("uses the explicitly selected component even when multiple text parameters have identical names",async()=>{
    const f=fixture(),second=fixture();second.state.text="subtitle";
    f.chain.getComponentCount=()=>2;
    f.chain.getComponentAtIndex=(index?:number)=>index===1?second.component:f.component;
    // Both components participate in this project's locked transaction.
    second.param.createSetValueAction=v=>()=>{Object.assign(second.state,v.value);};
    const i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    expect(i.targets).toHaveLength(2);
    expect(await host.applyPremiereMogrtText(f.api,i,1,{text:"두 번째"})).toMatchObject({status:"text-updated",target:{componentIndex:1}});
    expect(f.state.text).toBe("원본");expect(second.state.text).toBe("두 번째");
  });
  it.each(["text","font","project","item","component","parameter","animated"])("blocks a stale target before writing: %s",async kind=>{
    const f=fixture(),i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    if(kind==="text")f.state.text="manual edit";
    if(kind==="font")f.state.fauxBold=false;
    if(kind==="project")f.project.guid.toString=()=>"another";
    if(kind==="item")f.item.getProjectItem=async()=>({getId:()=>"replaced"});
    if(kind==="component")f.component.getMatchName=async()=>"different";
    if(kind==="parameter")f.param.displayName="Other Text";
    if(kind==="animated")f.flags.varying=true;
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).toMatchObject({status:"blocked"});
    expect(f.writes()).toBe(0);
  });
  it("will not use a copied inspection as a live binding",async()=>{
    const f=fixture(),i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    await expect(host.applyPremiereMogrtText(f.api,JSON.parse(JSON.stringify(i)),0,{text:"new"})).rejects.toThrow(/INSPECTION_REQUIRED/);
    expect(f.writes()).toBe(0);
  });
  it.each(["clip","component","parameter"])("blocks an identically named replacement %s with the same asset and values",async kind=>{
    const f=fixture(),i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    if(kind==="clip")f.track.getTrackItems=()=>[{...f.item}];
    if(kind==="component")f.chain.getComponentAtIndex=()=>({...f.component});
    if(kind==="parameter")f.component.getParam=()=>({...f.param});
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).toMatchObject({status:"blocked",code:"TEXT_TARGET_IDENTITY_CHANGED"});
    expect(f.state.text).toBe("원본");expect(f.writes()).toBe(0);
  });
  it.each([{text:""},{text:"bad\u0000value"},{text:"ok",fontSize:NaN},{text:"ok",fontSize:0},{text:"ok",color:"red"}])("rejects invalid edits without writes: %j",async edit=>{
    const f=fixture(),i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    await expect(host.applyPremiereMogrtText(f.api,i,0,edit)).rejects.toThrow(/INVALID_TEXT_EDIT/);
    expect(f.writes()).toBe(0);
  });
  it("requires review after a transaction failure and will not retry the same inspection",async()=>{
    const f=fixture(),i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    f.project.executeTransaction=()=>false;
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).toMatchObject({status:"needs-review",code:"TEXT_TRANSACTION_FAILED"});
    await expect(host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).rejects.toThrow(/INSPECTION_CONSUMED/);
  });
  it("detects a host that silently ignores text or substitutes a font",async()=>{
    const f=fixture(),i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    f.param.createSetValueAction=()=>()=>{f.state.text="new";f.state.fontName="Fallback";};
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).toMatchObject({status:"needs-review",code:"TEXT_READBACK_MISMATCH",after:{fontName:"Fallback"}});
  });
  it("rejects a failed setter before a transaction",async()=>{
    const f=fixture(),i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    f.TextValue.prototype.setText=()=>false;
    expect(await host.applyPremiereMogrtText(f.api,i,0,{text:"new"})).toMatchObject({status:"blocked",code:"TEXT_VALUE_REJECTED"});
    expect(f.writes()).toBe(0);
  });
  it("snapshots edit input and rejects overlapping operations",async()=>{
    const f=fixture(),i=await host.inspectPremiereMogrtText(f.api,f.receipt);
    let release:((p:typeof f.project)=>void)|undefined;
    f.api.Project.getActiveProject=()=>new Promise(resolve=>{release=resolve;});
    const input={text:"intended"},pending=host.applyPremiereMogrtText(f.api,i,0,input);
    input.text="changed during await";
    await expect(host.applyPremiereMogrtText(f.api,i,0,{text:"duplicate"})).rejects.toThrow(/TEXT_BUSY/);
    f.api.Project.getActiveProject=async()=>f.project;release!(f.project);
    expect(await pending).toMatchObject({status:"text-updated",after:{text:"intended"}});
  });
});
