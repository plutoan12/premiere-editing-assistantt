import { buildRoughCutPlan, type CandidateReview } from '@pea/rough-cut';
import { createApplyGate, validateInterpretation, type ApplyHost, type Preview, type HostSnapshot } from '@pea/premiere-rough-cut';
import type { MediaProvider } from '@pea/rough-media/wire';
import { analyzeMedia } from './index.js';
export function createRoughController(host: ApplyHost, changed: () => void = () => undefined) {
  const gate = createApplyGate(host); let busy = false, progress = 0, message = '', serial = 0;
  let result: Awaited<ReturnType<typeof analyzeMedia>> | undefined, pinned: HostSnapshot | undefined, provider: MediaProvider | undefined, preview: Preview | undefined, abort: AbortController | undefined;
  const reviews = new Map<string, CandidateReview['action']>();
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const idle = () => { if (busy) throw new Error('operation busy'); };
  const clearPreview = () => { preview = undefined; gate.invalidate(); };
  const seconds = (t: { ticks: bigint; timebase: { numerator: number; denominator: number } }) => Number(t.ticks) * t.timebase.numerator / t.timebase.denominator;
  return {
    state() { return { busy, progress, message, canCancel: !!abort, canPreview: !!result && !busy, canApply: !!preview && !busy, cutCount: preview?.cutCount, candidates: result?.candidates.map(c => ({ id: c.id, start: seconds(c.sourceRange.start), end: seconds(c.sourceRange.start) + seconds(c.sourceRange.duration), action: reviews.get(c.id) ?? 'pending' })) ?? [] }; },
    cancel() { abort?.abort(); },
    async analyze(p: MediaProvider) {
      idle(); clearPreview(); result = undefined; pinned = undefined; provider = p; reviews.clear(); busy = true; progress = 0; abort = new AbortController(); message = '오디오 분석 중'; changed();
      try {
        const initial = await host.snapshot();
        const r = await analyzeMedia(p, initial.sourcePath, initial.clipId, { signal: abort.signal, onProgress: value => { progress = value; changed(); } });
        if (!same(initial, await host.snapshot())) throw new Error('selection/project changed during analysis');
        validateInterpretation(initial.interpretation, r.media); result = r; pinned = initial; message = '후보 검토: 결정하지 않은 구간은 유지돼';
      } catch (e) { message = e instanceof Error ? e.message : '분석 실패'; throw e;
      } finally { busy = false; abort = undefined; changed(); }
    },
    review(id: string, action: CandidateReview['action']) {
      idle(); if (!result?.candidates.some(c => c.id === id) || !['keep', 'exclude'].includes(action)) throw new Error('invalid candidate review');
      clearPreview(); reviews.set(id, action); changed();
    },
    async preview() {
      idle(); clearPreview(); if (!result || !pinned) throw new Error('analysis required'); busy = true; changed();
      try {
        if (!same(pinned, await host.snapshot())) throw new Error('selection/project changed; analyze again');
        const m = result.media, id = `rough-${Date.now()}-${++serial}`, timebase = { numerator: m.frameRate.denominator, denominator: m.frameRate.numerator };
        const duration = { ticks: BigInt(m.durationFrames), timebase };
        const built = buildRoughCutPlan({ id, name: `PEA Rough ${id}`, clipId: pinned.clipId, mediaDuration: duration, sourceRange: { start: { ticks: 0n, timebase }, duration }, frameRate: { rate: m.frameRate, dropFrame: false }, candidates: result.candidates, reviews: [...reviews].map(([candidateId, action]) => ({ candidateId, action })) });
        preview = await gate.preview(built.plan, m, pinned.clipId); message = `${preview.cutCount}개 유지 구간. 적용하면 새 시퀀스만 추가돼.`;
      } catch (e) { message = e instanceof Error ? e.message : '미리보기 실패'; throw e;
      } finally { busy = false; changed(); }
    },
    async apply() {
      idle(); if (!preview || !result || !provider || !pinned) throw new Error('fresh preview required'); const approved = preview; preview = undefined; busy = true; message = '파일 재확인 후 새 시퀀스 추가 중'; changed();
      try {
        if (!same(result.media, await provider.probe(result.media.path))) throw new Error('source file changed; analyze again');
        if (!same(pinned, await host.snapshot())) throw new Error('selection/project changed; analyze again');
        await gate.apply(approved.id); result = undefined; message = '새 러프 시퀀스가 추가됐어. 재생으로 컷 경계·싱크·오디오 채널을 확인해.';
      } catch (e) { result = undefined; message = e instanceof Error ? e.message : '적용 실패. 프로젝트를 확인해.'; throw e;
      } finally { busy = false; changed(); }
    }
  };
}
