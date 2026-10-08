/** Test-only Premiere fixture. It deliberately enforces transaction-scoped Actions. */
import assert from 'node:assert/strict';
export const TPS = 254016000000;
export function premiereFixture() {
  let inside = false, locked = false;
  const audit: string[] = [];
  const items = ['a', 'b'].map(id => ({
    name: id, path: `/fixture/${id}.wav`, inSeconds: 0, outSeconds: 8, offline: false,
    getId: () => id,
    getMediaFilePath: async function() { return this.path; },
    getInPoint: async function() { return { seconds: this.inSeconds, ticks: String(Math.round(this.inSeconds * TPS)) }; },
    getOutPoint: async function() { return { seconds: this.outSeconds, ticks: String(Math.round(this.outSeconds * TPS)) }; },
    isOffline: async function() { return this.offline; }, isSequence: async () => false,
    isMergedClip: async () => false, isMulticamClip: async () => false,
  }));
  type Item = typeof items[number];
  type Placement = { item: Item; seconds: number; video: number; audio: number };
  function sequence(name: string, guid: string) {
    const placements: Placement[] = [];
    const settings = { ticksPerFrame: String(TPS / 24) };
    const track = (index: number) => ({ getTrackItems: () => placements.filter(p => p.audio === index).map(p => ({
      getProjectItem: async () => p.item, getStartTime: async () => ({ seconds: p.seconds, ticks: String(Math.round(p.seconds * TPS)) }),
    })) });
    return { name, guid, placements, settings,
      getSettings: async () => settings, getTimebase: async () => settings.ticksPerFrame,
      getFrameSize: async () => ({ width: 1920, height: 1080 }),
      getAudioTrack: async (index: number) => track(index), getVideoTrack: async () => ({ getTrackItems: () => [] }),
      getAudioTrackCount: async () => placements.length, getVideoTrackCount: async () => 0,
      createSetSettingsAction(value: typeof settings) { assert.ok(inside, 'Action outside transaction'); return () => Object.assign(settings, value); },
    };
  }
  const template = sequence('Template', 'template');
  const sequences = [template];
  const project = {
    guid: 'project-1', path: '/fixture/test-copy.prproj', name: 'test-copy',
    getSequences: async () => sequences, getActiveSequence: async () => template,
    createSequence: async (name: string, _preset = '') => { audit.push('create'); const s=sequence(name,`seq-${sequences.length}`); sequences.push(s); return s; },
    lockedAccess(fn: () => void) { locked=true; try { fn(); } finally { locked=false; } },
    executeTransaction(fn: (compound: { addAction(a: unknown): void }) => void) {
      assert.ok(locked, 'transaction outside locked access'); inside=true;
      const actions: Array<() => unknown> = [];
      try { fn({ addAction(a) { assert.equal(typeof a,'function'); actions.push(a as () => unknown); } }); }
      finally { inside=false; }
      actions.forEach(a=>a()); audit.push('transaction'); return true;
    },
  };
  let active = project;
  let selected = items;
  const ppro = {
    Project: { getActiveProject: async () => active },
    ProjectUtils: { getSelection: async () => ({ getItems: async () => selected }) },
    ClipProjectItem: { cast: (item: Item) => item },
    Constants: { MediaType: { AUDIO: 2, VIDEO: 1 }, TrackItemType: { CLIP: 1 } },
    TickTime: { createWithSeconds: (seconds: number) => ({ seconds, ticks: String(Math.round(seconds * TPS)) }) },
    SequenceEditor: { getEditor: (s: typeof template) => ({
      createInsertProjectItemAction(item: Item, time: {seconds:number}, v: number, a: number, limit: boolean) {
        assert.ok(inside, 'Action outside transaction'); assert.equal(limit,true,'cross-track ripple must be limited');
        return () => { s.placements.push({ item, seconds: time.seconds, video: v, audio: a }); audit.push(`place:${item.getId()}`); };
      },
    }) },
  };
  return { ppro, project, items, sequences, template, audit,
    select: (value: Item[]) => { selected=value; },
    switchProject: () => { active={...project,guid:'different-project'}; },
  };
}
