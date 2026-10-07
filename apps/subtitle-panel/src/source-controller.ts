import {
  createPremiereTranscriptAdapter,
  type PremiereClip,
  type PremiereTranscriptAPI,
  type PremiereTranscriptSnapshot
} from "@pea/premiere-transcript";
import { observeTranscriptTask, throwIfTranscriptAborted } from "@pea/transcript";

interface ProjectIdentity { readonly guid?: { toString(): string }; }
interface SourceClip extends PremiereClip { getMediaFilePath(): Promise<string>; }
interface SelectedItem { readonly name?: string; getId(): string | Promise<string>; }

/** Narrow injected surface of Premiere UXP 25.6+. No Adobe module is loaded here. */
export interface PremiereSourceHost {
  Project: { getActiveProject(): Promise<ProjectIdentity | null> };
  ProjectUtils: { getSelection(project: ProjectIdentity): Promise<{ getItems(): Promise<unknown[]> }> };
  ClipProjectItem: { cast(item: unknown): SourceClip | null | Promise<SourceClip | null> };
  Transcript?: PremiereTranscriptAPI<SourceClip>;
}

export interface SelectedPremiereTranscript {
  snapshot: PremiereTranscriptSnapshot;
  mediaAssetId: string;
  mediaPath: string;
  label: string;
  projectKey: string;
}

function stableIdentity(value: unknown, kind: string): string {
  if (typeof value !== "string" || !value.trim() || value === "[object Object]") {
    throw new Error(`${kind} identity is unavailable`);
  }
  return value;
}

function projectIdentity(project: ProjectIdentity | null): string {
  if (!project) throw new Error("no active Premiere project");
  const id = stableIdentity(project.guid?.toString(), "project");
  if (/^\{?00000000-0000-0000-0000-000000000000\}?$/.test(id)) throw new Error("project identity is empty");
  return id;
}

/**
 * Capture a single source selection once, then resolve only that pinned clip.
 * Selection changes do not redirect the operation. Project changes and source
 * relinks invalidate it, including changes made while native work is in flight.
 * Native work already queued in Premiere may continue after cancellation.
 */
export async function readSelectedPremiereTranscript(
  ppro: PremiereSourceHost,
  options: { allowTranscription?: boolean; signal?: AbortSignal } = {}
): Promise<SelectedPremiereTranscript> {
  const wait = <T>(work: () => Promise<T>) => observeTranscriptTask(work, options.signal);
  const project = await wait(() => ppro.Project.getActiveProject());
  const projectId = projectIdentity(project);
  const selection = await wait(() => ppro.ProjectUtils.getSelection(project!));
  const items = await wait(() => selection.getItems());
  if (!Array.isArray(items) || items.length !== 1) {
    throw new Error("select exactly one source clip in the Project panel");
  }
  const item = items[0] as SelectedItem | null;
  if (!item || typeof item.getId !== "function") throw new Error("selection is not a source clip");
  const itemId = stableIdentity(await wait(async () => item.getId()), "project item");
  const clip = await wait(async () => ppro.ClipProjectItem.cast(item));
  if (!clip || typeof clip.isSequence !== "function" || typeof clip.getMediaFilePath !== "function") {
    throw new Error("selection is not a source clip");
  }
  const isSequence = await wait(() => clip.isSequence());
  if (isSequence === true) throw new Error("sequence selection requires explicit timeline projection");
  if (isSequence !== false) throw new Error("invalid source clip sequence status");
  const mediaPath = await wait(() => clip.getMediaFilePath());
  if (typeof mediaPath !== "string" || !mediaPath.trim()) throw new Error("source media path is unavailable");
  const label = typeof item.name === "string" && item.name.trim() ? item.name : mediaPath;
  const projectKey = `premiere-project:${projectId}`;
  // JSON tuple encoding avoids delimiter collisions between project and item IDs.
  const mediaAssetId = `premiere:${JSON.stringify([projectId, itemId])}`;
  const pinnedClip = clip;

  async function requireCurrentSource(): Promise<void> {
    const currentMediaPath = await wait(() => pinnedClip.getMediaFilePath());
    const current = await wait(() => ppro.Project.getActiveProject());
    if (!current || projectIdentity(current) !== projectId) throw new Error("active project changed; reload the source transcript");
    if (currentMediaPath !== mediaPath) throw new Error("source media path changed; reload the source transcript");
    throwIfTranscriptAborted(options.signal);
  }
  await requireCurrentSource();

  const hostAPI = ppro.Transcript ?? {};
  const api: PremiereTranscriptAPI<SourceClip> = {};
  if (typeof hostAPI.exportToJSON === "function") api.exportToJSON = async value => {
    await requireCurrentSource();
    return hostAPI.exportToJSON!(value);
  };
  if (typeof hostAPI.hasTranscript === "function") api.hasTranscript = async value => {
    await requireCurrentSource();
    return hostAPI.hasTranscript!(value);
  };
  if (typeof hostAPI.transcribeClipProjectItem === "function") api.transcribeClipProjectItem = async value => {
    await requireCurrentSource();
    return hostAPI.transcribeClipProjectItem!(value);
  };
  const adapter = createPremiereTranscriptAdapter({
    api,
    allowTranscription: options.allowTranscription === true,
    resolveClip: async requestedId => {
      await requireCurrentSource();
      return requestedId === mediaAssetId ? clip : null;
    }
  });
  const snapshot = await adapter.readSnapshot({ mediaAssetId, mediaPath, signal: options.signal });
  await requireCurrentSource();
  return { snapshot, mediaAssetId, mediaPath, label, projectKey };
}
