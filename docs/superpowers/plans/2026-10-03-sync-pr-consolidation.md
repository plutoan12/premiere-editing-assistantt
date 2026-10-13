# Sync PR Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace competing Sync PR #2/#3 implementations with one canonical `@pea/sync` API that preserves Core-native contracts from PR #2 and the stronger safety/regression behavior from PR #3.

**Architecture:** Start from PR #2 head `49c96f9e3ad669f62d541bcf23bd23808440bbb5` because its public contracts already use Core `Provenance`, `SequencePlan`, and signed reference-relative `MediaTime`. Port only behavior and tests from PR #3 that close concrete safety gaps; do not merge the two source trees mechanically. The consolidated branch remains NLE/FFmpeg independent and becomes the sole Sync dependency for the Native Helper.

**Tech Stack:** TypeScript 5.9, Node 22, pnpm, Vitest, `@pea/core`.

**Spec:** `docs/superpowers/specs/2026-10-03-premiere-local-pipeline-design.md`

## Global Constraints

- Required cloud services: none.
- `@pea/sync` never imports Premiere, UXP, FFmpeg process APIs, or HTTP server code.
- Preserve exact rational/bigint time semantics; no silent frame-rate, DF/NDF, sample-rate, or clock-domain conversion.
- Fingerprints are cache/routing identity only, never alignment proof.
- Ambiguous/silent/partial/unsupported results remain reviewable instead of being silently accepted.
- Cancellation and provider failures must not mutate source media or promote invalid artifacts.
- PR #2 and PR #3 must not both be merged independently.
- Whole-workspace tests and typecheck are required before the consolidated PR is considered merge-ready.

## Review Focus

1. Decoder/provider returns a reused mutable PCM buffer: cached reference data must be snapshotted before later reads mutate it.
2. Correlation best peak sits exactly on a configured artificial search boundary: return review, not a confident match.
3. Two equal/repeated audio peaks with `minMargin: 0`: equality must still be ambiguous.
4. Playback batch contains one provider failure: successful takes remain usable and the failed take is explicit.
5. Re-sync sees one full source occurrence plus a partial duplicate: report conflict/review, never silently choose the full occurrence.

---

### Task 1: Canonical public contract and compatibility matrix

**Files:**
- Modify: `packages/sync/src/types.ts`
- Modify: `packages/sync/src/index.ts`
- Create: `packages/sync/src/public-api.test.ts`
- Create: `docs/superpowers/reports/2026-10-03-sync-consolidation-matrix.md`

**Interfaces:**
- Consumes: Core `FrameRate`, `MediaTime`, `Provenance`, `SequencePlan`, `TimeRange`.
- Produces: PR #2 canonical names `SyncEvidence`, `SyncCandidate`, `SyncMember`, `SyncGroup`, `SyncOptions`, `syncClips()`; explicit public exports only.

- [ ] **Step 1: Write failing public API tests**
  Assert that root `@pea/sync` exposes the canonical PR #2 surface and that deprecated PR #3-only orchestration names are not needed by any package consumer.
- [ ] **Step 2: Run `pnpm --filter @pea/sync test -- public-api.test.ts`**
  Expected: RED until the explicit consolidated export surface exists.
- [ ] **Step 3: Make exports explicit and document the #2/#3 mapping**
  Keep PR #2 Core-native model. Add only metadata fields needed by surviving #3 behavior (`cameraId`, `role`) without duplicating Core time representations.
- [ ] **Step 4: Run package test + typecheck**
  `pnpm --filter @pea/sync test && pnpm --filter @pea/sync typecheck` → PASS.
- [ ] **Step 5: Commit**
  `git commit -m "refactor(sync): define consolidated public contract"`

### Task 2: Harden AudioSampleProvider ownership and validation

**Files:**
- Modify: `packages/sync/src/audio-provider.ts`
- Modify: `packages/sync/src/sync.ts`
- Test: `packages/sync/src/sync.test.ts`
- Create/port: `packages/sync/src/safety.test.ts`

**Interfaces:**
- Consumes: PR #2 `AudioSampleProvider.read(evidence, context): Promise<AudioSampleWindow>`.
- Produces: validated immutable/snapshotted windows before they enter cache/correlation; bounded window contract.

- [ ] **Step 1: Port failing reused-buffer regression tests from PR #3**
  Cover reference read followed by target read mutating the same backing typed array; cover playback master reuse.
- [ ] **Step 2: Run targeted tests**
  Expected: at least reused-buffer cases fail on PR #2 behavior before the fix.
- [ ] **Step 3: Implement `snapshotAudioWindow(window: AudioSampleWindow): AudioSampleWindow`**
  Validate first, clone samples, preserve sampleRate/startSample/provenance fields. Cache the snapshot, never the provider-owned buffer.
- [ ] **Step 4: Add/verify hard maximum sample-window validation**
  Oversized/non-finite/out-of-range normalized PCM must fail as provider/validation error, never allocate an unbounded correlation.
- [ ] **Step 5: Run package suite + typecheck**
  Expected: PASS.
- [ ] **Step 6: Commit**
  `git commit -m "fix(sync): isolate provider audio buffers"`

### Task 3: Merge correlation ambiguity and boundary safety

**Files:**
- Modify: `packages/sync/src/audio-correlation.ts`
- Modify if required: `packages/sync/src/fft.ts`
- Test: `packages/sync/src/audio-correlation.test.ts`
- Test: `packages/sync/src/safety.test.ts`

**Interfaces:**
- Consumes: `AudioSampleWindow`, `AudioCorrelationOptions`.
- Produces: `AudioCorrelationResult` with PR #2 status/reason vocabulary and no offset on review results.

- [ ] **Step 1: Add RED tests for equal periodic peaks when `minMargin=0`, invalid exclusion radius, and artificial search-boundary peak**
- [ ] **Step 2: Add independent direct-sum FFT parity test across signed lags**
  Expected: verifies correlation indexing independent of the production FFT helper.
- [ ] **Step 3: Implement minimal safety rules**
  Equal peaks are ambiguous even at zero configured margin; exclusion cannot hide the search domain; an artificial configured boundary peak is review-required.
- [ ] **Step 4: Run correlation tests, package tests, typecheck**
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "fix(sync): reject ambiguous boundary audio matches"`

### Task 4: Preserve partial success and cancellation in orchestration/playback

**Files:**
- Modify: `packages/sync/src/sync.ts`
- Modify: `packages/sync/src/playback.ts`
- Test: `packages/sync/src/sync.test.ts`
- Test: `packages/sync/src/playback.test.ts`

**Interfaces:**
- Consumes: hardened provider/correlation from Tasks 2-3.
- Produces: `syncClips()` canonical group plus a playback result that preserves per-take outcomes without timecode fallback.

- [ ] **Step 1: Write RED tests**
  Provider failure for one target does not erase successful candidates; pre/mid-flight cancellation propagates AbortError; an uncooperative provider promise does not keep caller waiting after abort; playback always ignores recording timecode.
- [ ] **Step 2: Define `PlaybackTakeResult { takeId: string; group: SyncGroup }` and `syncPlaybackBatch(...): Promise<PlaybackTakeResult[]>`**
  Keep existing `syncPlayback()` only if current repository consumers require it; otherwise export one batch API, not two synonyms.
- [ ] **Step 3: Implement per-take isolation with one snapshotted cached master**
  Failed take returns a review group/candidate; cancellation still aborts the whole requested batch.
- [ ] **Step 4: Run targeted + package suite/typecheck**
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "feat(sync): preserve playback partial results"`

### Task 5: Consolidate multicam identity and conservative re-sync

**Files:**
- Modify: `packages/sync/src/multicam.ts`
- Modify: `packages/sync/src/resync.ts`
- Test: `packages/sync/src/multicam.test.ts`
- Test: `packages/sync/src/resync.test.ts`

**Interfaces:**
- Consumes: canonical `SyncEvidence`, Core `SequencePlan` and exact Core time math.
- Produces: deterministic connected overlap groups preserving source/camera/role metadata; `ResyncResult` using Core sequence decisions.

- [ ] **Step 1: Add RED multicam tests**
  Preserve `cameraId/sourceId/role`; touching half-open intervals are disconnected; different clock/day identities never group.
- [ ] **Step 2: Add RED re-sync tests**
  Full + partial duplicate is conflicted; deleted source is unmapped; trimmed artifact is unmapped; duplicate full source is conflicted; unsupported retiming is explicit.
- [ ] **Step 3: Implement without introducing PR #3's parallel `ResyncSegment` model**
  Continue consuming Core `SequencePlan`; detect intersecting duplicate occurrences before selecting a unique full placement.
- [ ] **Step 4: Run targeted + package suite/typecheck**
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "fix(sync): preserve identity and conservative resync"`

### Task 6: Consolidated verification and supersession PR

**Files:**
- Modify: `packages/sync/README.md`
- Modify: `docs/superpowers/reports/2026-10-03-sync-consolidation-matrix.md`

**Interfaces:**
- Consumes: Tasks 1-5 final public API.
- Produces: one documented Sync API ready for Native Helper integration.

- [ ] **Step 1: Run full verification**
  `pnpm --filter @pea/sync test && pnpm --filter @pea/sync typecheck && pnpm test && pnpm typecheck`.
  Expected: all commands exit 0.
- [ ] **Step 2: Verify no forbidden imports**
  Search `packages/sync` for Premiere/UXP, `child_process`, FFmpeg command invocation, HTTP server imports.
  Expected: none.
- [ ] **Step 3: Compare consolidated regression matrix against PR #2 and #3**
  Every behavior intentionally retained/dropped has a written reason; no claim of real-footage validation.
- [ ] **Step 4: Push a new consolidated branch and open one PR against `feat/core-contracts`**
  PR body names #2/#3 as superseded candidates but does not close/merge them until consolidated CI succeeds.
- [ ] **Step 5: Wait for GitHub CI and inspect install/test/typecheck jobs**
  Expected: SUCCESS on consolidated head SHA.
- [ ] **Step 6: Only after green CI, mark #2/#3 superseded in their PR descriptions/comments**
  Do not merge either old PR. Keep history available for audit.
