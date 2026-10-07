import { validateMogrtPreviewRequest, type MogrtPreviewReceipt } from "./uxp-mogrt.js";

/** Release gate, not API detection. 27.1.0.7 reads AE text but writes fail
 * readback with an unsupported MogrtText encoding. See the host evidence record. */
export const MOGRT_TEXT_WRITE_VERIFIED = false;

/** Structural subset of Adobe's 27.0 beta API. No SDK or Node runtime dependency. */
interface TextValue {
  getText(): string; getFontName(): string; getFontSize(): number;
  getAllCaps(): boolean; getFauxBold(): boolean; getFauxItalic(): boolean; getSmallCaps(): boolean;
  isUniformStyling(): boolean; isFontNameEditable(): boolean; isFontSizeEditable(): boolean;
  setText(value: string): boolean; setFontName(value: string): boolean; setFontSize(value: number): boolean;
  setAllCaps(value: boolean): boolean; setFauxBold(value: boolean): boolean;
  setFauxItalic(value: boolean): boolean; setSmallCaps(value: boolean): boolean;
}
interface Param {
  displayName: string; getStartValue(): Promise<unknown>; isTimeVarying(): boolean;
  createKeyframe(value: TextValue): unknown; createSetValueAction(value: unknown): unknown;
}
interface Component { getMatchName(): Promise<string>; getParamCount(): number; getParam(index: number): Param }
interface Chain { getComponentCount(): number; getComponentAtIndex(index: number): Component }
interface Item {
  getName(): Promise<string>; getStartTime(): Promise<{ticks:string}>; getEndTime(): Promise<{ticks:string}>;
  getProjectItem(): Promise<{getId():string}|null>;
  getComponentChain(): Promise<Chain>;
}
interface Sequence {
  guid:{toString():string}; getVideoTrack(index:number):Promise<{getTrackItems(type:number,empty:boolean):Item[]}>;
}
interface Project {
  guid:{toString():string}; getSequences():Promise<Sequence[]>;
  lockedAccess(callback:()=>void):void;
  executeTransaction(callback:(compound:{addAction(action:unknown):boolean})=>void,name:string):boolean;
}
export interface PremiereMogrtTextApi {
  MogrtText?: new()=>TextValue;
  Project:{getActiveProject():Promise<Project|null>};
  Constants:{TrackItemType:{CLIP:number}};
}
export interface MogrtTextSnapshot {
  text:string; fontName:string; fontSize:number;
  allCaps:boolean; fauxBold:boolean; fauxItalic:boolean; smallCaps:boolean;
}
export interface MogrtTextEdit { text:string; fontName?:string; fontSize?:number }
export interface MogrtTextTarget {
  componentIndex:number; componentMatchName:string; parameterIndex:number; parameterName:string;
  before:MogrtTextSnapshot; fontNameEditable:boolean; fontSizeEditable:boolean;
}
export interface MogrtTextInspection {
  status:"unsupported"|"ready"|"no-editable-text";
  targets:MogrtTextTarget[];
  skipped:{componentIndex:number;parameterIndex:number;code:string}[];
}
export interface MogrtTextEditReceipt {
  status:"blocked"|"text-updated"|"needs-review";
  projectId:string; sequenceId:string; decisionId:string;
  target:{componentIndex:number;componentMatchName:string;parameterIndex:number;parameterName:string};
  before:MogrtTextSnapshot; after?:MogrtTextSnapshot;
  graphicsApplied:false; unapplied:readonly string[]; code?:string;
}
interface Session {
  api:PremiereMogrtTextApi; preview:MogrtPreviewReceipt & {sequenceId:string}; assetId:string|null;
  item:Item; bindings:{component:Component;param:Param}[]; targets:MogrtTextTarget[]; consumed:boolean;
}
const sessions=new WeakMap<MogrtTextInspection,Session>();
const busy=new WeakSet<object>();
function fail(code:string):never { throw Error(code); }
function codeOf(error:unknown):string {
  const message=error instanceof Error?error.message:"";
  return /^[A-Z_]{1,64}$/.test(message)?message:"TEXT_HOST_ERROR";
}
export function validateMogrtTextEdit(input:unknown):MogrtTextEdit {
  if(!input||typeof input!=="object"||Array.isArray(input))fail("INVALID_TEXT_EDIT");
  const v=input as Record<string,unknown>;
  if(Object.keys(v).some(k=>!["text","fontName","fontSize"].includes(k))
    ||typeof v.text!=="string"||!v.text.trim()||v.text.length>16384||/[\x00-\x08\x0b-\x1f\x7f]/.test(v.text))fail("INVALID_TEXT_EDIT");
  if(v.fontName!==undefined&&(typeof v.fontName!=="string"||!v.fontName.trim()||v.fontName.length>256||/[\x00-\x1f]/.test(v.fontName)))fail("INVALID_TEXT_EDIT");
  if(v.fontSize!==undefined&&(typeof v.fontSize!=="number"||!Number.isFinite(v.fontSize)||v.fontSize<=0||v.fontSize>10000))fail("INVALID_TEXT_EDIT");
  return {text:v.text,...(v.fontName===undefined?{}:{fontName:v.fontName as string}),...(v.fontSize===undefined?{}:{fontSize:v.fontSize as number})};
}
export function validateMogrtTextDraft(input:unknown) {
  if(!input||typeof input!=="object"||Array.isArray(input))fail("INVALID_TEXT_DRAFT");
  const value=input as Record<string,unknown>;
  if(value.schemaVersion!=="1.0.0"||value.mode!=="editable-text-draft"
    ||Object.keys(value).some(k=>!["schemaVersion","mode","preview","edit"].includes(k)))fail("INVALID_TEXT_DRAFT");
  return {schemaVersion:"1.0.0" as const,mode:"editable-text-draft" as const,
    preview:validateMogrtPreviewRequest(value.preview),edit:validateMogrtTextEdit(value.edit)};
}
function asText(value:unknown):TextValue {
  const methods=["getText","getFontName","getFontSize","getAllCaps","getFauxBold","getFauxItalic","getSmallCaps",
    "isUniformStyling","isFontNameEditable","isFontSizeEditable"];
  if(!value||typeof value!=="object"||!methods.every(k=>typeof (value as Record<string,unknown>)[k]==="function"))fail("TEXT_VALUE_UNAVAILABLE");
  const text=value as TextValue;
  if(!text.isUniformStyling())fail("MIXED_TEXT_STYLING");
  return text;
}
function snapshot(text:TextValue):MogrtTextSnapshot {
  return {text:text.getText(),fontName:text.getFontName(),fontSize:text.getFontSize(),allCaps:text.getAllCaps(),
    fauxBold:text.getFauxBold(),fauxItalic:text.getFauxItalic(),smallCaps:text.getSmallCaps()};
}
function same(a:MogrtTextSnapshot,b:MogrtTextSnapshot):boolean {
  return (Object.keys(a) as (keyof MogrtTextSnapshot)[]).every(k=>a[k]===b[k]);
}
async function locate(api:PremiereMogrtTextApi,preview:MogrtPreviewReceipt & {sequenceId:string},assetId?:string|null) {
  const project=await api.Project.getActiveProject();
  if(!project||project.guid.toString()!==preview.projectId)fail("PROJECT_CHANGED");
  const sequence=(await project.getSequences()).find(s=>s.guid.toString()===preview.sequenceId);
  if(!sequence)fail("SEQUENCE_MISSING");
  const track=await sequence.getVideoTrack(0),items=track.getTrackItems(api.Constants.TrackItemType.CLIP,false);
  if(items.length!==1)fail("PREVIEW_ITEM_CHANGED");
  const item=items[0],expected=preview.items[0];
  if(await item.getName()!==expected.name||(await item.getStartTime()).ticks!==expected.startTicks
    ||(await item.getEndTime()).ticks!==expected.endTicks)fail("PREVIEW_ITEM_CHANGED");
  // Native graphics can have no project media item (observed on 27.1.0.7).
  // Null is part of the binding; live clip/component/parameter identity remains required.
  const projectItem=await item.getProjectItem(),id=projectItem===null?null:projectItem.getId();
  if(assetId!==undefined&&id!==assetId)fail("PREVIEW_ITEM_CHANGED");
  return {project,item,assetId:id,chain:await item.getComponentChain()};
}
/** Inspect only a successful single-item preview. Typed values are returned directly
 * by getStartValue in 27.x, not in the scalar keyframe.value.value wrapper. */
export async function inspectPremiereMogrtText(api:PremiereMogrtTextApi,receipt:MogrtPreviewReceipt):Promise<MogrtTextInspection> {
  if(typeof api.MogrtText!=="function")return {status:"unsupported",targets:[],skipped:[]};
  if(busy.has(api))fail("TEXT_BUSY");
  if(receipt.status!=="preview-created"||!receipt.sequenceId||receipt.items.length!==1)fail("SUCCESSFUL_PREVIEW_REQUIRED");
  const preview={...receipt,sequenceId:receipt.sequenceId,items:receipt.items.map(i=>({...i}))};
  busy.add(api);
  try {
    const {chain,item,assetId}=await locate(api,preview);
    const bindings:Session["bindings"]=[];
    const result:MogrtTextInspection={status:"no-editable-text",targets:[],skipped:[]};
    for(let c=0;c<chain.getComponentCount();c++) {
      const component=chain.getComponentAtIndex(c),matchName=await component.getMatchName();
      for(let p=0;p<component.getParamCount();p++) {
        try {
          const param=component.getParam(p);
          if(param.isTimeVarying())fail("TIME_VARYING_TEXT");
          const value=asText(await param.getStartValue());
          result.targets.push({componentIndex:c,componentMatchName:matchName,parameterIndex:p,parameterName:param.displayName,
            before:snapshot(value),fontNameEditable:value.isFontNameEditable(),fontSizeEditable:value.isFontSizeEditable()});
          bindings.push({component,param});
        } catch(error) { result.skipped.push({componentIndex:c,parameterIndex:p,code:codeOf(error)}); }
      }
    }
    if(result.targets.length) {
      result.status="ready";
      // The visible report is never the source of a live write binding.
      sessions.set(result,{api,preview,assetId,item,bindings,targets:result.targets.map(t=>({...t,before:{...t.before}})),consumed:false});
    }
    return result;
  } finally { busy.delete(api); }
}
async function resolveParam(chain:Chain,target:MogrtTextTarget,binding:Session["bindings"][number]):Promise<Param> {
  if(target.componentIndex>=chain.getComponentCount())fail("TEXT_BINDING_CHANGED");
  const component=chain.getComponentAtIndex(target.componentIndex);
  if(component!==binding.component)fail("TEXT_TARGET_IDENTITY_CHANGED");
  if(await component.getMatchName()!==target.componentMatchName||target.parameterIndex>=component.getParamCount())fail("TEXT_BINDING_CHANGED");
  const param=component.getParam(target.parameterIndex);
  if(param!==binding.param)fail("TEXT_TARGET_IDENTITY_CHANGED");
  if(param.displayName!==target.parameterName)fail("TEXT_BINDING_CHANGED");
  if(param.isTimeVarying())fail("TIME_VARYING_TEXT");
  return param;
}
/** Experimental host-verification primitive; production UI writes are gated by
 * MOGRT_TEXT_WRITE_VERIFIED. A single parameter edit, not full caption layout application.
 * No automatic retry/rollback: after starting a transaction, consume the inspection
 * even if the host throws or returns false. Read again before another user edit. */
export async function applyPremiereMogrtText(api:PremiereMogrtTextApi,inspection:MogrtTextInspection,targetIndex:number,input:unknown):Promise<MogrtTextEditReceipt> {
  const edit=validateMogrtTextEdit(input),session=sessions.get(inspection);
  if(!session||session.api!==api)fail("INSPECTION_REQUIRED");
  if(busy.has(api))fail("TEXT_BUSY");
  if(session.consumed)fail("INSPECTION_CONSUMED");
  const target=session.targets[targetIndex];
  if(!Number.isSafeInteger(targetIndex)||!target)fail("INVALID_TEXT_TARGET");
  const {preview}=session;
  const result:MogrtTextEditReceipt={status:"blocked",projectId:preview.projectId,sequenceId:preview.sequenceId,decisionId:preview.decisionId,
    target:{componentIndex:target.componentIndex,componentMatchName:target.componentMatchName,parameterIndex:target.parameterIndex,parameterName:target.parameterName},
    before:{...target.before},graphicsApplied:false,unapplied:["caption-layout","caption-style","emphasis","placement","other-template-properties"]};
  busy.add(api);
  try {
    if(typeof api.MogrtText!=="function")fail("UNSUPPORTED_TEXT_API");
    const {project,chain,item}=await locate(api,preview,session.assetId);
    // Asset IDs identify media, not clip occurrences. Without stable live wrappers,
    // decline the edit rather than guessing from identical names/times/values.
    if(item!==session.item)fail("TEXT_TARGET_IDENTITY_CHANGED");
    const binding=session.bindings[targetIndex];
    const param=await resolveParam(chain,target,binding),current=asText(await param.getStartValue());
    if(!same(snapshot(current),target.before))fail("TEXT_CHANGED_SINCE_INSPECTION");
    if(edit.fontName!==undefined&&!current.isFontNameEditable())fail("FONT_NAME_LOCKED");
    if(edit.fontSize!==undefined&&!current.isFontSizeEditable())fail("FONT_SIZE_LOCKED");
    const desired={...target.before,...edit},value=new api.MogrtText();
    // Construct a detached value, preserving every uniform font flag. Author
    // restrictions above are checked on the original value, not this constructor.
    if(!value.setText(desired.text)||!value.setFontName(desired.fontName)||!value.setFontSize(desired.fontSize)
      ||!value.setAllCaps(desired.allCaps)||!value.setFauxBold(desired.fauxBold)||!value.setFauxItalic(desired.fauxItalic)
      ||!value.setSmallCaps(desired.smallCaps))fail("TEXT_VALUE_REJECTED");
    if(!same(snapshot(asText(value)),desired))fail("TEXT_VALUE_REJECTED");
    // Recheck the active project after asynchronous reads. Host SDK getters are
    // async, so this is optimistic conflict detection, not a compare-and-swap claim.
    if((await api.Project.getActiveProject())?.guid.toString()!==preview.projectId)fail("PROJECT_CHANGED");
    const latest=asText(await param.getStartValue());
    if(!same(snapshot(latest),target.before)||param.isTimeVarying())fail("TEXT_CHANGED_SINCE_INSPECTION");
    project.lockedAccess(()=>{
      session.consumed=true;result.status="needs-review";
      const committed=project.executeTransaction(compound=>{
        const action=param.createSetValueAction(param.createKeyframe(value));
        if(!compound.addAction(action))fail("TEXT_TRANSACTION_FAILED");
      },"PEA editable MOGRT text");
      if(!committed)fail("TEXT_TRANSACTION_FAILED");
    });
    const verified=await locate(api,preview,session.assetId);
    if(verified.item!==session.item)fail("TEXT_TARGET_IDENTITY_CHANGED");
    result.after=snapshot(asText(await (await resolveParam(verified.chain,target,binding)).getStartValue()));
    if(!same(result.after,desired))fail("TEXT_READBACK_MISMATCH");
    result.status="text-updated";
  } catch(error) { result.code=codeOf(error); }
  finally { busy.delete(api); }
  return result;
}
