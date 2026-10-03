import type { ApplyHost, HostSnapshot } from './gate.js';
import type { MediaDescriptor } from '@pea/rough-media/wire';
export function validateInterpretation(text: string, media: MediaDescriptor): void {
  const f = JSON.parse(text), fps = media.frameRate.numerator / media.frameRate.denominator;
  if (!Number.isFinite(f.fps) || Math.abs(f.fps - fps) > 0.0001 || f.par !== 1 || f.pulldown !== false || ![f.defaultField, f.progressiveField].includes(f.field) || (f.lut && !/^[{}0-]+$/.test(f.lut))) throw new Error('unsupported source interpretation: use original frame rate, square pixels, no pulldown or LUT override');
}
/** Adobe objects are confined to this boundary. Mocks test calls, not Premiere compatibility. */
export function createPremiereHost(ppro: any, fs: any): ApplyHost {
  const guid = (x: any): string => { const id = x?.guid?.toString(); if (typeof id !== 'string' || !id || id === '[object Object]') throw new Error('host identity unavailable'); return id; };
  const tick = (x: any): string => { if (typeof x?.ticks !== 'string' || !/^-?\d+$/.test(x.ticks)) throw new Error('host time unavailable'); return x.ticks; };
  async function project(): Promise<any> { const p = await ppro.Project.getActiveProject(); if (!p || typeof p.path !== 'string' || !p.path.startsWith('/')) throw new Error('save a disposable project copy first'); guid(p); return p; }
  async function snapshot(): Promise<HostSnapshot> {
    const p = await project(), selected = await (await ppro.ProjectUtils.getSelection(p)).getItems();
    if (!Array.isArray(selected) || selected.length !== 1) throw new Error('select exactly one original source clip in the Project panel');
    const raw = selected[0], clipId = await raw.getId(), c = ppro.ClipProjectItem.cast(raw);
    if (!c || await c.isOffline() || await c.isMergedClip() || await c.isMulticamClip() || await c.isSequence()) throw new Error('unsupported or offline source clip');
    if (await c.hasProxy()) throw new Error('proxy source is not supported in v1');
    const sourcePath = await c.getMediaFilePath(), f = await c.getFootageInterpretation();
    if (typeof sourcePath !== 'string' || !sourcePath.startsWith('/') || !clipId) throw new Error('source identity unavailable');
    const interpretation = JSON.stringify({ fps: f.getFrameRate(), par: f.getPixelAspectRatio(), field: f.getFieldType(), defaultField: f.FIELD_TYPE_DEFAULT, progressiveField: f.FIELD_TYPE_PROGRESSIVE, pulldown: f.getRemovePullDown(), lut: f.getInputLUTID() });
    const sequences = await p.getSequences(); if (sequences.length > 200) throw new Error('project sequence limit for review snapshot');
    const listing = [];
    for (const s of sequences) listing.push([guid(s), String(s.name), tick(await s.getEndTime())]);
    const active = await p.getActiveSequence(), placement: unknown[] = [];
    if (active) for (const type of ['Video', 'Audio']) {
      const count = await active[`get${type}TrackCount`](); if (!Number.isSafeInteger(count) || count > 128) throw new Error('track snapshot limit');
      for (let i = 0; i < count; i++) {
        const track = await active[`get${type}Track`](i), items = await track.getTrackItems(1, false);
        if (items.length + placement.length > 5000) throw new Error('clip snapshot limit');
        placement.push([type, i, await track.isMuted()]);
        for (const item of items) placement.push([type, i, await (await item.getProjectItem()).getId(), tick(await item.getStartTime()), tick(await item.getEndTime()), tick(await item.getInPoint()), tick(await item.getOutPoint()), await item.getSpeed()]);
      }
    }
    // Relevant-state snapshot, not a claim to fingerprint every effect/marker in the project.
    return { projectId: guid(p), projectPath: p.path, clipId, sourcePath, interpretation, sequenceState: JSON.stringify({ listing, active: active ? guid(active) : null, placement }) };
  }
  return {
    snapshot,
    async writeXml(xml, planId) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(planId)) throw new Error('invalid XML artifact identity');
      const folder = await fs.getDataFolder(), file = await folder.createFile(`pea-rough-${planId}.xml`, { overwrite: false });
      await file.write(xml); if (typeof file.nativePath !== 'string' || !file.nativePath.startsWith('/')) throw new Error('XML artifact path unavailable'); return file.nativePath;
    },
    async importXml(path, approved, name) {
      if (JSON.stringify(approved) !== JSON.stringify(await snapshot())) throw new Error('stale project at import');
      const p = await project(), before = [...await p.getSequences()];
      if (before.some((s: any) => s.name === name)) throw new Error('rough sequence name already exists');
      const ids = new Set(before.map(guid)), root = await p.getRootItem();
      // Do not wrap async importFiles in the synchronous executeTransaction/lockedAccess callbacks.
      if (!await p.importFiles([path], true, root, false)) return false;
      const after = await p.getSequences(), added = after.filter((s: any) => !ids.has(guid(s)));
      if (added.length !== 1 || added[0].name !== name || after.length !== before.length + 1) throw new Error('unexpected import result; inspect project');
      return true;
    }
  };
}
