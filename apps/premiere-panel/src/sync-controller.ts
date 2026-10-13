import { applySyncDryRun, buildSyncDryRun } from '@pea/premiere-adapter';
import type { ApplyReport, PremiereProjectSnapshot, PremiereSyncDryRun } from '@pea/premiere-adapter';
import { copyWire } from '@pea/sync-helper-client/file';
import type { FileHelperClient } from '@pea/sync-helper-client/file';
import type { SyncGroup, SyncCandidate } from '@pea/sync';
import type { ClipBinding, PremiereSelection, SelectedClip, UxpPremiereHost } from './premiere-host.js';

export interface AnalyzeParameters {
  referenceClipId: string; mode: 'auto' | 'audio' | 'playback'; sampleRate: number;
  startSeconds: number; durationSeconds: number;
}
export interface ControllerDependencies {
  readSelection(): Promise<PremiereSelection>;
  createHost(bindings: readonly ClipBinding[]): UxpPremiereHost;
  onChange?: (view: ControllerView) => void;
}
export interface ControllerView {
  phase: 'disconnected' | 'ready' | 'analyzing' | 'review' | 'dry-run' | 'applying' | 'completed' | 'error' | 'cancelled';
  message: string;
  rows: Array<{clipId:string;status:string;score:number;reason:string;offsetSeconds?:number}>;
  plan?: PremiereSyncDryRun;
  report?: ApplyReport & {readbackIssues:string[]};
}
function same(a:unknown,b:unknown):boolean { return JSON.stringify(a)===JSON.stringify(b); }
function errorMessage(error:unknown):string { return error instanceof Error?error.message:'UNKNOWN_ERROR'; }
function timeValid(t:SyncCandidate['offset']):boolean {
  return !!t && typeof t.ticks==='bigint' && Number.isSafeInteger(t.timebase?.numerator) && t.timebase.numerator>0
    && Number.isSafeInteger(t.timebase.denominator) && t.timebase.denominator>0 && Number.isSafeInteger(Number(t.ticks));
}
function validateGroup(group:SyncGroup,sources:SelectedClip[],reference:string):void {
  if(!group || group.schemaVersion!=='1.0.0' || group.referenceClipId!==reference || !Array.isArray(group.members)
    || !Array.isArray(group.candidates) || group.members.length>sources.length || group.candidates.length!==sources.length-1) throw new Error('INVALID_SYNC_RESULT');
  const known=new Set(sources.map(s=>s.clipId)),members=new Set<string>(),candidates=new Set<string>();
  for(const c of group.candidates){
    if(!known.has(c.clipId)||c.clipId===reference||candidates.has(c.clipId)||c.referenceClipId!==reference
      || !['matched','review'].includes(c.status)||!Number.isFinite(c.confidence?.score)||c.confidence.score<0||c.confidence.score>1
      || (c.status==='matched'&&!timeValid(c.offset))) throw new Error('INVALID_SYNC_CANDIDATE');
    candidates.add(c.clipId);
  }
  for(const m of group.members){
    if(!known.has(m.clipId)||members.has(m.clipId)||!timeValid(m.offset))throw new Error('INVALID_SYNC_MEMBER');
    members.add(m.clipId);
    if(m.clipId===reference){if(m.offset.ticks!==0n)throw new Error('INVALID_REFERENCE_OFFSET');continue;}
    const c=group.candidates.find(c=>c.clipId===m.clipId);
    if(!c||c.status!=='matched'||!c.offset||c.offset.ticks*BigInt(c.offset.timebase.numerator)*BigInt(m.offset.timebase.denominator)
      !==m.offset.ticks*BigInt(m.offset.timebase.numerator)*BigInt(c.offset.timebase.denominator))throw new Error('INCONSISTENT_SYNC_OFFSET');
  }
  if(!members.has(reference))throw new Error('MISSING_REFERENCE');
  if(group.candidates.some(c=>c.status==='matched'&&!members.has(c.clipId)))throw new Error('MISSING_MATCHED_MEMBER');
}
function validateVersions(value:unknown,sources:SelectedClip[]):Record<string,string>{
  const v=value as Record<string,string>;
  if(!v||typeof v!=='object'||sources.some(s=>typeof v[s.clipId]!=='string'||!v[s.clipId]))throw new Error('INVALID_SOURCE_VERSIONS');
  return Object.fromEntries(sources.map(s=>[s.clipId,v[s.clipId]]));
}
/** Owns the only approved plan. Display copies can never authorize or alter an Apply. */
export class SyncController {
  private helper?:FileHelperClient;
  private host?:UxpPremiereHost;
  private selection?:PremiereSelection;
  private sourceVersions?:Record<string,string>;
  private analysisState?:PremiereProjectSnapshot;
  private group?:SyncGroup;
  private plan?:PremiereSyncDryRun;
  private epoch=0;
  private abort?:AbortController;
  private state:ControllerView={phase:'disconnected',message:'Helper 폴더를 연결해줘.',rows:[]};
  constructor(private readonly deps:ControllerDependencies){}
  get view():ControllerView{return copyWire(this.state);}
  private emit(patch:Partial<ControllerView>):void{this.state={...this.state,...patch};this.deps.onChange?.(this.view);}
  private reset():void{this.epoch++;this.abort?.abort();this.abort=undefined;this.plan=undefined;this.group=undefined;this.selection=undefined;this.analysisState=undefined;this.sourceVersions=undefined;this.host=undefined;}
  connect(helper:FileHelperClient):void{
    if(this.state.phase==='applying')throw new Error('APPLY_IN_PROGRESS');
    this.reset();this.helper=helper;this.emit({phase:'ready',message:'Helper 연결됨. 원본 클립과 기준 시퀀스를 선택해줘.',rows:[],plan:undefined,report:undefined});
  }
  invalidate():void{
    if(this.state.phase==='applying')return;
    this.reset();this.emit({phase:this.helper?'ready':'disconnected',message:'설정이 바뀌었어. 다시 분석해줘.',rows:[],plan:undefined,report:undefined});
  }
  cancel():void{
    if(this.state.phase==='applying')return; // Native actions already committed cannot be cancelled/rolled back by this UI.
    this.reset();this.emit({phase:'cancelled',message:'분석 취소됨. 원본과 시퀀스는 변경하지 않았어.',rows:[],plan:undefined});
  }
  async analyze(parameters:AnalyzeParameters):Promise<void>{
    if(this.state.phase==='applying'||this.state.phase==='analyzing')throw new Error('BUSY');
    if(!this.helper)throw new Error('HELPER_NOT_CONNECTED');
    this.reset();const epoch=this.epoch,helper=this.helper,ac=new AbortController();this.abort=ac;
    this.emit({phase:'analyzing',message:'선택 미디어 확인 중',rows:[],plan:undefined,report:undefined});
    try{
      const selection=await this.deps.readSelection();
      if(selection.clips.length<2||selection.clips.length>16)throw new Error('SELECT_2_TO_16_SOURCE_CLIPS');
      if(!selection.clips.some(c=>c.clipId===parameters.referenceClipId))throw new Error('SELECT_REFERENCE_CLIP');
      const host=this.deps.createHost(selection.clips),before=await host.snapshot();
      if(before.media.length!==selection.clips.length||selection.clips.some(c=>!before.media.some(m=>m.projectItemId===c.projectItemId)))throw new Error('STALE_SELECTION');
      if(epoch!==this.epoch)return;
      const sources=selection.clips.map(c=>({clipId:c.clipId,mediaAssetId:c.mediaAssetId,path:c.path,outSeconds:c.outSeconds}));
      const result=await helper.request('sync',{...parameters,sources},{signal:ac.signal,onProgress:p=>{
        if(epoch===this.epoch)this.emit({message:`${p.stage}: ${p.completed}/${p.total}`});
      }}) as {group:SyncGroup;sourceVersions:unknown};
      if(epoch!==this.epoch||ac.signal.aborted)return;
      if(!same(before,await host.snapshot()))throw new Error('STALE_ANALYSIS_PROJECT');
      const group=copyWire(result.group);validateGroup(group,selection.clips,parameters.referenceClipId);
      this.group=group;this.host=host;this.selection=selection;this.analysisState=before;
      this.sourceVersions=validateVersions(result.sourceVersions,selection.clips);
      this.emit({phase:'review',message:'분석 완료. 점수는 유사도이며 정확도 확률이 아니야. 검수 항목은 배치하지 않아.',
        rows:group.candidates.map(c=>({clipId:c.clipId,status:c.status,score:c.confidence.score,reason:c.reason,
          offsetSeconds:c.status==='matched'&&c.offset?Number(c.offset.ticks)*c.offset.timebase.numerator/c.offset.timebase.denominator:undefined}))});
    }catch(error){if(epoch!==this.epoch)return;this.plan=undefined;this.emit({phase:ac.signal.aborted?'cancelled':'error',message:errorMessage(error),plan:undefined});throw error;}
    finally{if(epoch===this.epoch)this.abort=undefined;}
  }
  async dryRun(sequenceName:string):Promise<PremiereSyncDryRun>{
    if(!this.group||!this.host||!this.selection||!this.analysisState||!['review','dry-run'].includes(this.state.phase))throw new Error('ANALYZE_FIRST');
    this.plan=undefined;this.emit({plan:undefined});
    try{
      if(!same(this.analysisState,await this.host.snapshot()))throw new Error('STALE_ANALYSIS_PROJECT');
      if(this.group.members.length<2)throw new Error('NOT_ENOUGH_MATCHED_CLIPS');
      if(!sequenceName.trim()||sequenceName.length>120)throw new Error('INVALID_SEQUENCE_NAME');
      const plan=buildSyncDryRun(this.group,this.analysisState,{sequenceName,frameRate:this.selection.frameRate});
      if(plan.errors.length||plan.operations.length<2)throw new Error(plan.errors.join('; ')||'NOT_ENOUGH_MATCHED_CLIPS');
      if(plan.operations.some(o=>!Number.isFinite(o.startSeconds)||o.startSeconds<0))throw new Error('INVALID_PLACEMENT');
      this.plan=copyWire(plan);this.emit({phase:'dry-run',plan:copyWire(plan),message:'미리보기만 생성했어. 프로젝트는 아직 변경하지 않았어.'});return copyWire(plan);
    }catch(error){this.emit({phase:'error',plan:undefined,message:errorMessage(error)});throw error;}
  }
  async apply(confirmedTestCopy:boolean):Promise<ApplyReport&{readbackIssues:string[]}>{
    if(!confirmedTestCopy)throw new Error('CONFIRM_DISPOSABLE_PROJECT_COPY');
    if(!this.plan||!this.helper||!this.host||!this.selection||!this.sourceVersions||this.state.phase!=='dry-run')throw new Error('VALID_DRY_RUN_REQUIRED');
    const plan=this.plan,helper=this.helper,host=this.host,selection=this.selection,versions=this.sourceVersions;
    this.plan=undefined;this.emit({phase:'applying',plan:undefined,message:'전용 Sync 시퀀스에 적용 중. 기존 편집 시퀀스는 건드리지 않아.'});
    try{
      await helper.request('ping',{}, {timeoutMs:5000});
      const probe=await helper.request('probe',{sources:selection.clips}) as {sourceVersions:unknown};
      if(!same(versions,validateVersions(probe.sourceVersions,selection.clips)))throw new Error('SOURCE_CHANGED');
      const applied=await applySyncDryRun(host,plan);
      const readbackIssues=applied.sequenceId?await host.verifyPlacements(applied.sequenceId,plan.operations):['No sequence was created'];
      const report={...applied,readbackIssues};
      this.emit({phase:applied.failed.length||readbackIssues.length?'error':'completed',report,
        message:applied.failed.length||readbackIssues.length?'일부 적용/검증 실패. 생성된 Sync 시퀀스를 확인해줘. 자동 롤백은 하지 않았어.':'배치 적용과 Premiere 타임라인 위치 재검증 완료. 영상·음성은 직접 재생해 확인해줘.'});
      return copyWire(report);
    }catch(error){const sequenceId=(error as {sequenceId?:string})?.sequenceId;
      this.emit({phase:'error',message:`${errorMessage(error)}${sequenceId?` (생성된 시퀀스: ${sequenceId})`:''}`});throw error;}
  }
}
