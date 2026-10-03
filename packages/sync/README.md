# @pea/sync — deterministic synchronization engine

A source-preserving, NLE-independent engine. This package does **not** install a Premiere panel or decode media files. It extends the approved Sync Engine plan on top of `feat/core-contracts`.

## Implemented

- Explicit-rate timecode parsing and exact `bigint` offsets, including 29.97/59.94 drop-frame labels and explicit midnight rollover.
- Audio alignment using bounded FFT-assisted, mean-centered normalized correlation and direct peak refinement. Handles offsets, crops, head silence, gain/DC differences and polarity inversion.
- Similarity and competing-peak checks. Silence, unrelated/periodic audio, insufficient overlap and mismatched sample rates return review results rather than a fabricated zero offset.
- Reference-anchored batch orchestration: compatible timecode, then measured audio, then manual review. Partial successes and provider provenance are preserved.
- Temporal-overlap multicam groups for explicitly compatible recording clocks; camera/recorder identities are retained.
- Music/playback takes aligned to a master by audio, deliberately ignoring recording timecode.
- Exact source-anchored artifact remapping after 1x ripple, trim and reorder edits. Removed/trimmed artifacts are unmapped; duplicated source placements are conflicts.
- Cooperative CPU checkpoints and prompt asynchronous cancellation even when a decoder promise ignores its abort signal.

## Timecode example

```ts
import { buildTimecodeSyncGroup, parseTimecode } from '@pea/sync';
const frameRate = { rate: { numerator: 30000, denominator: 1001 }, dropFrame: true };
const group = buildTimecodeSyncGroup('scene-01', [
  { clipId: 'cam-a', sourceId: 'A', clockId: 'shoot-day-1/jam-1', frameRate,
    timecodeTicks: parseTimecode('01:00:00;00', frameRate).ticks },
  { clipId: 'recorder', sourceId: 'R', clockId: 'shoot-day-1/jam-1', frameRate,
    timecodeTicks: parseTimecode('01:00:01;00', frameRate).ticks },
]);
// recorder offset: 30 ticks at 1001/30000 seconds per tick.
```

`clockId` asserts a shared clock/jam session AND recording-day identity. Metadata does not independently verify that cameras were correctly jammed. Bare frame numbers or a fingerprint string no longer imply a valid match. Missing/incompatible metadata falls back to audio/review, never silent rate conversion. `parseTimecode(..., dayOffset)` unwraps midnight only when explicitly requested.

## Audio provider contract

Implement `AudioSampleProvider.read(clip, context)` in the host. Return mono normalized `Float32Array` samples, an explicit sample rate and a `bigint startSample` relative to **selected clip-local zero**, not file zero. The host must apply channel selection, downmixing and any resampling explicitly; sample rates must match. Each window is limited to 262144 samples.

`syncClips(id, clips, { audioProvider, referenceClipId, signal })` compares every target to the same reference, reusing its decoded window. `syncPlayback(id, master, takes, options)` forces audio matching.

Positive `member.offset` means place the target later than reference clip zero. Negative offsets are valid. For decoded windows the placement is `correlationLag + reference.startSample - target.startSample`. `offsetTicks` is an alias and is meaningless without `offset.timebase`.

Scores are deterministic similarity measures, **not calibrated probabilities**. Review candidates have no accepted offset and do not become aligned members. A wholly unsuccessful group contains only its reference and has `status: 'review'` with confidence zero. Consumers must inspect status before applying anything.

## Deliberate scope decisions

1. Explicit clock/rate metadata is required for timecode acceptance. Cost: unlabelled clips need audio or review.
2. Global bounded FFT correlation plus exact peak refinement replaces lossy coarse decimation, preserving sample-level peaks. Cost: long recordings still require a host window scheduler and performance validation.
3. Automatic multicam session discovery currently uses timecode overlap only. Audio-only batches require a selected common reference; no speculative all-pairs graph or clock-drift correction is included.
4. Artifact remapping requires full source-range containment and 1x edits. It does not perform phonetic subtitle alignment, translated-dub timing, partial artifact splitting, speed ramps or drift correction.

## Validation and remaining release gates

There are 43 engine tests, including a 150-placement seeded offset sweep. Local network access was unavailable: the identical compiled assertions ran using native `node:test` registration in place of Vitest. This local fallback is not a TypeScript check; canonical checks are:

```sh
pnpm install --no-frozen-lockfile
pnpm test
pnpm typecheck
```

The final review was an author self-review, not an independent reviewer. A reproduced hanging-provider cancellation regression was fixed test-first. Providers must still terminate their own underlying processes; rejecting the engine operation cannot kill an uncooperative decoder. FFT work is synchronous: run it in a worker for a responsive host UI.

Before a usable Premiere release: implement and verify an FFmpeg/ffprobe provider and long-file window strategy; test permitted real footage including noise, room delay and recording drift; add adapter dry-run/application and panel installation. No production footage, API keys, paid AI calls or source-media mutation are introduced here.


## Consolidated API note

PR #2 is the canonical contract baseline. The consolidated API keeps Core-native signed reference-relative `MediaTime`, `Provenance`, and `SequencePlan` integration while adding the safety regressions documented in `docs/superpowers/reports/2026-10-03-sync-consolidation-matrix.md`. Use `syncPlaybackBatch` when each playback take must retain an independent success/review result. Provider-owned PCM is snapshotted before caching. Validation and FFT helpers are intentionally not root exports.
