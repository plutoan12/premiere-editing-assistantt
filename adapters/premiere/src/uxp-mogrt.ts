/** Standalone UXP boundary: no Node, engine, or third-party runtime imports. */
export const PREMIERE_TICKS_PER_SECOND = 254016000000n;
const MAX_TICKS = 9223372036854775807n;
export interface MogrtPreviewRequest {
  schemaVersion: "1.0.0";
  mode: "template-preview";
  decisionId: string;
  templateId: string;
  templateVersion: string;
  templatePath: string;
  startTicks: string;
  durationTicks: string;
  frameTicks: string;
  canvas: { width: number; height: number };
}
interface TickTime { ticks: string }
interface Guid { toString(): string }
interface TrackItem {
  getStartTime(): Promise<TickTime>;
  getEndTime(): Promise<TickTime>;
  createSetEndAction(time: TickTime): unknown;
  getName(): Promise<string>;
}
interface Track { getTrackItems(type: number, includeEmpty: boolean): TrackItem[] }
interface Settings {
  setVideoFrameRate(rate: { ticksPerFrame: number }): boolean;
  setVideoFrameRect(rect: { width: number; height: number }): Promise<boolean>;
}
interface Sequence {
  guid: Guid; name: string;
  getSettings(): Promise<Settings>;
  createSetSettingsAction(settings: Settings): unknown;
  getTimebase(): Promise<string>;
  getFrameSize(): Promise<{width:number;height:number}>;
  getVideoTrack(index: number): Promise<Track>;
  getAudioTrack(index: number): Promise<Track>;
}
interface Project {
  guid: Guid;
  createSequence(name: string, presetPath: string): Promise<Sequence>;
  lockedAccess(callback: () => void): void;
  executeTransaction(callback: (compound: {addAction(action: unknown): void}) => void, name: string): boolean;
  openSequence(sequence: Sequence): Promise<boolean>;
}
/** Structural subset of Adobe's UXP API, injected as require("premierepro") by the panel. */
export interface PremiereMogrtApi {
  Project: { getActiveProject(): Promise<Project | null> };
  TickTime: { createWithTicks(ticks: string): TickTime; createWithSeconds(seconds: number): TickTime };
  FrameRate: new () => { ticksPerFrame: number };
  RectF: new () => { width: number; height: number };
  Constants: { TrackItemType: { CLIP: number; TRANSITION: number } };
  SequenceEditor: { getEditor(sequence: Sequence): {
    insertMogrtFromPath(path: string, time: TickTime, video: number, audio: number): TrackItem[];
  } };
}
function fail(code: string): never { throw new Error(code); }
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_PREVIEW_REQUEST");
  return input as Record<string, unknown>;
}
function tickValue(input: unknown, positive = false): bigint {
  if (typeof input !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(input)) fail("INVALID_TICKS");
  const value = BigInt(input);
  if (value > MAX_TICKS || (positive && value === 0n)) fail("INVALID_TICKS");
  return value;
}
export function validateMogrtPreviewRequest(input: unknown): MogrtPreviewRequest {
  const value = object(input);
  const keys = ["schemaVersion", "mode", "decisionId", "templateId", "templateVersion", "templatePath", "startTicks", "durationTicks", "frameTicks", "canvas"];
  if (Object.keys(value).some(key => !keys.includes(key)) || value.schemaVersion !== "1.0.0" || value.mode !== "template-preview") fail("INVALID_PREVIEW_REQUEST");
  for (const key of ["decisionId", "templateId", "templateVersion"])
    if (typeof value[key] !== "string" || !(value[key] as string).trim() || (value[key] as string).length > 256) fail("INVALID_PREVIEW_REQUEST");
  if (typeof value.templatePath !== "string" || /[\x00-\x1f]/.test(value.templatePath)
    || !/\.mogrt$/i.test(value.templatePath) || !(/^\/(?!\/)/.test(value.templatePath) || /^[A-Za-z]:[\\/]/.test(value.templatePath))
    || value.templatePath.split(/[\\/]/).includes("..")) fail("INVALID_TEMPLATE_PATH");
  const start = tickValue(value.startTicks), duration = tickValue(value.durationTicks, true), frame = tickValue(value.frameTicks, true);
  if (frame > BigInt(Number.MAX_SAFE_INTEGER) || start + duration > MAX_TICKS || start % frame || duration % frame) fail("UNREPRESENTABLE_TIME");
  const canvas = object(value.canvas);
  if (Object.keys(canvas).some(key => key !== "width" && key !== "height")) fail("INVALID_CANVAS");
  for (const key of ["width", "height"])
    if (!Number.isSafeInteger(canvas[key]) || (canvas[key] as number) <= 0 || (canvas[key] as number) > 32768) fail("INVALID_CANVAS");
  // Copy nested data before any await; callers cannot change the request during an edit.
  return { ...value, canvas: { width: canvas.width, height: canvas.height } } as MogrtPreviewRequest;
}
export interface MogrtPreviewReceipt {
  status: "preview-created" | "needs-review";
  projectId: string;
  sequenceId?: string;
  decisionId: string;
  graphicsApplied: false;
  unapplied: readonly string[];
  items: {name:string;startTicks:string;endTicks:string}[];
  code?: string;
}
const busy = new WeakSet<object>();
/** Inserts the ORIGINAL template into a NEW preview sequence. Never applies caption styling.
 * Once a host mutation starts, failures return a receipt for manual review, never auto-retry.
 * Adobe MOGRT import and the trim transaction are separate undo steps; no atomic rollback is claimed.
 */
export async function previewPremiereMogrt(api: PremiereMogrtApi, input: unknown, expectedProjectId: string): Promise<MogrtPreviewReceipt> {
  const request = validateMogrtPreviewRequest(input);
  if (busy.has(api)) fail("PREVIEW_BUSY");
  busy.add(api);
  try {
    if (!expectedProjectId || api.TickTime.createWithSeconds(1).ticks !== PREMIERE_TICKS_PER_SECOND.toString()) fail("UNSUPPORTED_HOST");
    const project = await api.Project.getActiveProject();
    if (!project || project.guid.toString() !== expectedProjectId) fail("PROJECT_CHANGED");
    const receipt: MogrtPreviewReceipt = {status:"needs-review",projectId:expectedProjectId,
      decisionId:request.decisionId,graphicsApplied:false,unapplied:["caption-text","caption-style","emphasis","placement","template-properties"],items:[]};
    let stage = "CREATE_SEQUENCE_FAILED";
    try {
      const sequence = await project.createSequence(`PEA Preview · ${request.decisionId}`, "");
      receipt.sequenceId = sequence.guid.toString();
      stage = "SETTINGS_FAILED";
      const settings = await sequence.getSettings();
      const rate = new api.FrameRate(); rate.ticksPerFrame = Number(request.frameTicks);
      const rect = new api.RectF(); rect.width = request.canvas.width; rect.height = request.canvas.height;
      if (!settings.setVideoFrameRate(rate) || !await settings.setVideoFrameRect(rect)) fail(stage);
      let committed = false;
      project.lockedAccess(() => { committed = project.executeTransaction(compound => {
        compound.addAction(sequence.createSetSettingsAction(settings));
      }, "PEA preview settings"); });
      if (!committed) fail(stage);
      const actualSize = await sequence.getFrameSize();
      if (await sequence.getTimebase() !== request.frameTicks || actualSize.width !== rect.width || actualSize.height !== rect.height) fail(stage);
      const video = await sequence.getVideoTrack(0), audio = await sequence.getAudioTrack(0);
      const editor = api.SequenceEditor.getEditor(sequence);
      let inserted: TrackItem[] = [];
      stage = "SEQUENCE_NOT_EMPTY";
      project.lockedAccess(() => {
        for (const track of [video, audio])
          for (const type of [api.Constants.TrackItemType.CLIP, api.Constants.TrackItemType.TRANSITION])
            if (track.getTrackItems(type, false).length) fail(stage);
        stage = "INSERT_FAILED";
        inserted = editor.insertMogrtFromPath(request.templatePath, api.TickTime.createWithTicks(request.startTicks), 0, 0);
      });
      if (!inserted.length) fail(stage);
      const endTicks = (BigInt(request.startTicks) + BigInt(request.durationTicks)).toString();
      stage = "RANGE_MISMATCH";
      for (const item of inserted)
        if ((await item.getStartTime()).ticks !== request.startTicks) fail(stage);
      stage = "TRIM_FAILED";
      project.lockedAccess(() => { committed = project.executeTransaction(compound => {
        for (const item of inserted) compound.addAction(item.createSetEndAction(api.TickTime.createWithTicks(endTicks)));
      }, "PEA preview duration"); });
      if (!committed) fail(stage);
      stage = "RANGE_MISMATCH";
      for (const item of inserted) {
        const result = {name:await item.getName(),startTicks:(await item.getStartTime()).ticks,endTicks:(await item.getEndTime()).ticks};
        receipt.items.push(result);
        if (result.startTicks !== request.startTicks || result.endTicks !== endTicks) fail(stage);
      }
      stage = "OPEN_PREVIEW_FAILED";
      if (!await project.openSequence(sequence)) fail(stage);
      receipt.status = "preview-created";
    } catch { receipt.code = stage; }
    return receipt;
  } finally { busy.delete(api); }
}
