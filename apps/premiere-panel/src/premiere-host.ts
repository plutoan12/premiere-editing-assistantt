import type { PremiereHost, PremiereProjectSnapshot, PremiereSyncOperation } from '@pea/premiere-adapter';

export interface ClipBinding { clipId: string; mediaAssetId?: string; projectItemId: string }
export interface ProjectItemLike { name: string; getId(): string }
export interface TickLike { seconds: number; ticks: string }
export interface ClipLike {
  getMediaFilePath(): Promise<string>;
  getInPoint(mediaType: number): Promise<TickLike>;
  getOutPoint(mediaType: number): Promise<TickLike>;
  isOffline(): Promise<boolean>; isSequence(): Promise<boolean>;
  isMergedClip(): Promise<boolean>; isMulticamClip(): Promise<boolean>;
}
interface TrackItemLike { getProjectItem(): Promise<ProjectItemLike>; getStartTime(): Promise<TickLike> }
interface TrackLike { getTrackItems(type: number, includeEmpty: boolean): TrackItemLike[] | Promise<TrackItemLike[]> }
export interface SequenceLike {
  guid: unknown; name: string;
  getSettings(): Promise<unknown>; getTimebase(): Promise<string>; getFrameSize(): Promise<unknown>;
  createSetSettingsAction(settings: unknown): unknown;
  getVideoTrack(index: number): Promise<TrackLike>; getAudioTrack(index: number): Promise<TrackLike>;
}
export interface ProjectLike {
  guid: unknown; path: string; name?: string;
  getSequences(): Promise<SequenceLike[]>; getActiveSequence(): Promise<SequenceLike | null>;
  createSequence(name: string, presetPath?: string): Promise<SequenceLike>;
  lockedAccess(fn: () => void): void;
  executeTransaction(fn: (compound: { addAction(action: unknown): void }) => void, undoString?: string): boolean;
}
export interface PremiereModuleLike {
  Project: { getActiveProject(): Promise<ProjectLike | null> };
  ProjectUtils: { getSelection(project: ProjectLike): Promise<{ getItems(): Promise<ProjectItemLike[]> }> };
  ClipProjectItem: { cast(item: ProjectItemLike): ClipLike | null };
  SequenceEditor: { getEditor(sequence: SequenceLike): {
    createInsertProjectItemAction(item: ProjectItemLike, time: TickLike, v: number, a: number, limitShift: boolean): unknown;
  }};
  TickTime: { createWithSeconds(seconds: number): TickLike };
  Constants: { MediaType: { AUDIO: number }; TrackItemType: { CLIP: number } };
}
export interface SelectedClip extends ClipBinding { name: string; path: string; inSeconds: number; outSeconds: number }
export interface PremiereSelection {
  project: ProjectLike; template: SequenceLike; items: ProjectItemLike[]; clips: SelectedClip[];
  frameRate: { numerator: number; denominator: number }; templateSignature: string;
}
function id(value: unknown): string {
  const result = String(value);
  if (!result || result === '[object Object]' || result === 'undefined' || result === 'null') throw new Error('Premiere stable GUID unavailable');
  return result;
}
export async function readPremiereSelection(ppro: PremiereModuleLike, templateId?: string, approvedItems?: ProjectItemLike[]): Promise<PremiereSelection> {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error('Premiere 프로젝트를 먼저 열어줘.');
  const template = templateId ? (await project.getSequences()).find(s=>id(s.guid)===templateId) : await project.getActiveSequence();
  if (!template) throw new Error('출력 설정을 가져올 기준 시퀀스를 먼저 열어줘.');
  const items = approvedItems ?? await (await ppro.ProjectUtils.getSelection(project)).getItems();
  const clips: SelectedClip[] = [];
  for (const item of items) {
    const clip = ppro.ClipProjectItem.cast(item);
    if (!clip || await clip.isSequence() || await clip.isMergedClip() || await clip.isMulticamClip()) {
      throw new Error('원본 미디어만 선택해줘. 중첩·병합·멀티캠·폴더는 이 버전에서 제외돼.');
    }
    if (await clip.isOffline()) throw new Error(`Offline media: ${item.name}`);
    const path = await clip.getMediaFilePath();
    const a = await clip.getInPoint(ppro.Constants.MediaType.AUDIO);
    const b = await clip.getOutPoint(ppro.Constants.MediaType.AUDIO);
    if (!path || !Number.isFinite(a.seconds) || a.seconds < 0 || !Number.isFinite(b.seconds) || b.seconds <= a.seconds) {
      throw new Error(`Unsupported media range: ${item.name}`);
    }
    // v1 does not guess how subclips or separate A/V In points map to file zero.
    if (Math.abs(a.seconds) > 1e-9) throw new Error(`Source In point must be zero: ${item.name}`);
    clips.push({ clipId: item.getId(), mediaAssetId: `${id(project.guid)}:${item.getId()}`,
      projectItemId: item.getId(), name: item.name, path, inSeconds: a.seconds, outSeconds: b.seconds });
  }
  if (new Set(clips.map(c=>c.clipId)).size !== clips.length) throw new Error('Duplicate project item id');
  const ticks = Number(await template.getTimebase()), second = Number(ppro.TickTime.createWithSeconds(1).ticks);
  if (!Number.isSafeInteger(ticks) || ticks <= 0 || !Number.isSafeInteger(second) || second <= 0) throw new Error('Unsupported sequence timebase');
  const frameRate = { numerator: second, denominator: ticks };
  const templateSignature = JSON.stringify([id(template.guid), ticks, await template.getFrameSize()]);
  return { project, template, items, clips, frameRate, templateSignature };
}
function mediaKey(clips: SelectedClip[]): string {
  return JSON.stringify(clips.map(c=>[c.projectItemId,c.name,c.path,c.inSeconds,c.outSeconds]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}
export interface UxpPremiereHost extends PremiereHost {
  verifyPlacements(sequenceId: string, operations: readonly PremiereSyncOperation[]): Promise<string[]>;
}
/** All mutations target a newly-created dedicated sequence, never the active edit. */
export function createPremiereUxpHost(ppro: PremiereModuleLike, bindings: readonly ClipBinding[] = []): UxpPremiereHost {
  let prepared: PremiereSelection | undefined;
  const owned = new Map<string, { sequence: SequenceLike; projectId: string; mediaKey: string; template: string; templateId: string; items: ProjectItemLike[]; projectPath: string }>();
  async function current(templateId?: string, approvedItems?: ProjectItemLike[]): Promise<PremiereSelection> { return readPremiereSelection(ppro,templateId,approvedItems); }
  function transaction(project: ProjectLike, name: string, action: () => unknown): void {
    const result: { accepted: boolean } = { accepted: false };
    project.lockedAccess(() => {
      result.accepted = project.executeTransaction(compound => {
        // Native Actions may not escape this synchronous callback.
        compound.addAction(action());
      }, name);
    });
    if (result.accepted !== true) throw new Error('Premiere transaction failed');
  }
  return {
    async snapshot(): Promise<PremiereProjectSnapshot> {
      const capture = await current(); prepared = capture;
      const sequences = await capture.project.getSequences();
      const maps = bindings.length ? bindings : capture.clips;
      return { projectId: id(capture.project.guid),
        projectVersion: JSON.stringify([id(capture.project.guid),capture.project.path,capture.templateSignature,
          mediaKey(capture.clips),sequences.map(s=>[id(s.guid),s.name]).sort()]),
        sequenceNames: sequences.map(s=>s.name),
        media: maps.filter(b=>capture.clips.some(c=>c.projectItemId===b.projectItemId)).map(b=>({
          clipId:b.clipId,mediaAssetId:b.mediaAssetId,projectItemId:b.projectItemId,
        })) };
    },
    async createSyncSequence(name: string): Promise<string> {
      const capture = await current(), project = capture.project;
      if (!name.trim() || name.length>120) throw new Error('Invalid sequence name');
      if ((await project.getSequences()).some(s=>s.name===name)) throw new Error('Sequence already exists');
      if (prepared && (id(project.guid)!==id(prepared.project.guid) || mediaKey(capture.clips)!==mediaKey(prepared.clips)
        || capture.templateSignature!==prepared.templateSignature)) throw new Error('Stale project before sequence creation');
      const settings = await capture.template.getSettings();
      const sequence = await project.createSequence(name, '');
      const sequenceId = id(sequence.guid);
      owned.set(sequenceId,{sequence,projectId:id(project.guid),mediaKey:mediaKey(capture.clips),template:capture.templateSignature,templateId:id(capture.template.guid),items:[...capture.items],projectPath:project.path});
      try {
        transaction(project,'PEA Sync: copy sequence settings',()=>sequence.createSetSettingsAction(settings));
        if (await sequence.getTimebase() !== await capture.template.getTimebase()) throw new Error('Sequence frame grid mismatch');
      } catch (error) {
        throw Object.assign(new Error('시퀀스 설정 적용 실패. 생성된 빈 Sync 시퀀스를 확인해줘.'),{sequenceId,cause:error});
      }
      return sequenceId;
    },
    async placeClip(sequenceId: string, operation: PremiereSyncOperation): Promise<void> {
      const target = owned.get(sequenceId);
      if (!target) throw new Error('Only an owned dedicated sequence can be modified');
      const capture = await current(target.templateId,target.items);
      if (id(capture.project.guid)!==target.projectId || capture.project.path!==target.projectPath) throw new Error('Active project changed');
      if (mediaKey(capture.clips)!==target.mediaKey || capture.templateSignature!==target.template) throw new Error('Stale source or template');
      if (!(await capture.project.getSequences()).some(s=>id(s.guid)===sequenceId)) throw new Error('Premiere sequence was removed');
      const item = capture.items.find(i=>i.getId()===operation.projectItemId);
      if (!item) throw new Error('Premiere project item not found');
      if (!Number.isFinite(operation.startSeconds) || operation.startSeconds<0 || !Number.isSafeInteger(operation.trackIndex) || operation.trackIndex<0) throw new Error('Invalid placement');
      const time = ppro.TickTime.createWithSeconds(operation.startSeconds);
      const editor = ppro.SequenceEditor.getEditor(target.sequence);
      transaction(capture.project,`PEA Sync: ${operation.clipId}`,()=>editor.createInsertProjectItemAction(
        item,time,operation.trackIndex,operation.trackIndex,true));
    },
    async verifyPlacements(sequenceId: string, operations: readonly PremiereSyncOperation[]): Promise<string[]> {
      const target = owned.get(sequenceId);
      if (!target) throw new Error('Unknown dedicated sequence');
      const project = await ppro.Project.getActiveProject();
      if (!project || id(project.guid)!==target.projectId) throw new Error('Active project changed before readback');
      const issues: string[] = [];
      for (const op of operations) {
        let count=0;
        for (const kind of ['getVideoTrack','getAudioTrack'] as const) {
          let track: TrackLike;
          try { track=await target.sequence[kind](op.trackIndex); } catch { continue; }
          for (const clip of await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false)) {
            if ((await clip.getProjectItem()).getId() !== op.projectItemId) { issues.push(`${op.clipId}: unexpected clip on allocated track`); continue; }
            count++;
            if (Math.abs((await clip.getStartTime()).seconds-op.startSeconds)>1e-7) issues.push(`${op.clipId}: placed time differs from dry run`);
          }
        }
        if (!count) issues.push(`${op.clipId}: inserted clip not found in native readback`);
      }
      return issues;
    },
  };
}
