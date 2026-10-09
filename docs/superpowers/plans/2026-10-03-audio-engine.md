# Audio Engine Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. User authorization takes precedence. Initial implementation was local-only; the user authorized committing and pushing the reviewed Audio/DSP integration to existing PR #13 on 2026-10-07. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the five Audio Engine workflows as an independently testable offline package.

**Architecture:** Public Core contracts plus Audio-owned versioned envelopes; pure signal/time/decision functions and injected cleanup/loudness providers. No Premiere SDK or other engine internals.

**Tech Stack:** Existing TypeScript, pnpm, Vitest and Zod dependencies. No new DSP library.

**Spec:** `docs/superpowers/specs/2026-10-03-audio-engine-design.md`

## Global Constraints

- No source-media mutation or deletion; no Core contract changes.
- Integer/rational canonical time; no implicit resampling or frame-rate conversion.
- Preserve previous valid artifacts on failure/cancellation/stale results.
- Vendor SDKs stay behind provider interfaces; unsupported capability is explicit.
- Initial work was local-only. The later PR #13 integration approval permits its commit, push and PR metadata update; media uploads and service execution remain outside scope.
- User separately approved dependency installation and full verification.

## Review Focus

1. Fractional-frame alignment must remain exact over long recordings (Task 1).
2. Anti-phase stereo must retain energy and malformed samples must fail (Task 2).
3. Ducking at clipped attack/release edges must retain the correct gain (Task 3).
4. An ignored cancellation or stale result must never promote an artifact (Task 5).
5. Silence, unknown true peak and malformed provider results must not produce a misleading normalization gain (Tasks 4–5).

## Tasks

### Task 1: Exact time and validated PCM contracts

**Files:** `packages/audio/package.json`, `tsconfig.json`, `src/time.ts`, `src/pcm.ts`, `src/time.test.ts`.
**Interfaces:** Core MediaTime, TimeRange, ClipReference, MediaFingerprint; produces sampleTime, timeToSamples, sourceToSequenceTime, PcmInput and validatePcm.
- [x] Write tests for NTSC/long sample indices, explicit rounding, source bounds and unsafe timebases; observe failure.
- [x] Implement exact arithmetic with checked rational denominators and strict PCM metadata/sample validation.
- [x] Run `pnpm --filter @pea/audio test` and `pnpm --filter @pea/audio typecheck`; require success.

### Task 2: Dialogue and transient/beat analysis

**Files:** `src/dialogue.ts`, `src/beats.ts`, `src/analysis.test.ts`.
**Interfaces:** consumes PcmInput and Core Transcript; produces measureSampleLevels, analyzeDialogue, detectBeats with explicit no-dialogue/silence/insufficient/irregular states.
- [x] Test literal stereo RMS/peak, transcript range intersection, source immutability, silence, 120-BPM pulses and irregular intervals; observe failure.
- [x] Implement per-channel energy without downmixing, bounded gain proposals and threshold-onset/periodicity analysis.
- [x] Require focused tests and typecheck to pass.

### Task 3: Ducking and versioned decision serialization

**Files:** `src/ducking.ts`, `src/decisions.ts`, `src/ducking.test.ts`.
**Interfaces:** buildDuckingEnvelope takes sample intervals and explicit settings, returns AudioEnvelopeDecision wrapping Core AudioDecision; serializeAudioDecision/parseAudioDecision use decimal tick strings.
- [x] Test overlap/hold, clipped ramps, invalid intervals, exact bigint round-trip and future-version rejection; observe failure.
- [x] Implement conservative interval merging and strictly ordered linear-dB points.
- [x] Require focused tests and typecheck to pass.

### Task 4: Loudness normalization proposals

**Files:** `src/loudness.ts`, `src/loudness.test.ts`.
**Interfaces:** proposeNormalization takes validated integrated LUFS/true peak and explicit target/ceiling/max gain; returns gain or a silence/unsupported result.
- [x] Test independent target/headroom cases, silence, missing true peak, nonfinite and inconsistent measurements; observe failure.
- [x] Implement gain limited by target, positive-gain budget and true-peak headroom; no limiter or rendering.
- [x] Require focused tests and typecheck to pass.

### Task 5: Provider execution, artifact lifecycle and cache

**Files:** `src/jobs.ts`, `src/jobs.test.ts`.
**Interfaces:** runAudioJob, AudioProvider, AudioJobRequest, AudioJobResult, AudioCache; consumes Core MediaAsset/Job/Artifact and public promotion helper.
- [x] Test valid cleanup/loudness promotion, missing provider, derivative mismatch, cache hit/invalidation, rejection, cancellation, retry and stale results; observe failure.
- [x] Implement request/result validation, canonical cache identity, snapshot isolation and cancellation race.
- [x] Require tests and typecheck to pass; mocks verify orchestration only.

### Task 6: Public exports, usage and regression verification

**Files:** `src/index.ts`, `README.md`, `src/public-api.test.ts`, root `pnpm-lock.yaml`.
- [x] Verify consumer workflows through @pea/audio's public surface and versioned wire format.
- [x] Document the five workflows, provider contracts, time semantics and unsupported real-world checks.
- [x] Run `pnpm test`, `pnpm typecheck`, and `git diff --check`; inspect all outputs and final diff.
- [x] Record changed files, baseline evidence, failures, unrun checks and remaining limitations below.

## Execution evidence

- Base: `9f2119ce55bd090c86e84b058725776a9405228c`; original checkout and unrelated untracked files left intact.
- Ruling: Core exists on an existing local feature branch, so use that immutable baseline in an isolated worktree instead of replacing the documentation-only checkout.
- Ruling: Pin only the already-declared dependency graph in a lockfile; installation scripts are skipped. No new DSP package is introduced.


## Final verification — 2026-10-03

- Runtime: Node.js 24.18.1. Final commands use repository-pinned pnpm 10.17.1.
- Baseline before Audio changes: Core 13 tests and Sync 4 tests passed; both typechecks passed (exit 0).
- Final command: `npm exec --yes --package=pnpm@10.17.1 -- pnpm test` — exit 0; Audio 52 + Core 13 + Sync 4 = 69 tests passed, 0 failed.
- Final command: `npm exec --yes --package=pnpm@10.17.1 -- pnpm typecheck` — exit 0; Audio/Core/Sync passed.
- Reproducibility: `CI=true npm exec --yes --package=pnpm@10.17.1 -- pnpm install --frozen-lockfile --ignore-scripts` — exit 0; locked dependency graph accepted.
- `git diff --check` — exit 0. New untracked files are additionally checked individually with `git diff --no-index --check /dev/null <file>` before handoff.
- Red/green evidence: the initial feature suites failed due to absent implementations before passing; review regressions reproduced missing-gain NaN, normalization Infinity and ramp Infinity before their fixes. A BigInt test-title formatting error was also corrected.
- Setup failures resolved: the bundled pnpm 11 test launcher initially auto-installed dependencies and rejected ignored esbuild build scripts; explicit installation with scripts disabled succeeded. Switching dependency layout to pnpm 10 first rejected a non-TTY reinstall, then completed with CI=true. These were environment/setup failures, not pre-existing code failures.
- Fresh read-only reviewer: no outstanding Critical, Important or Minor findings after the fixes. Reviewer additionally probed cancellation with late completion, previous-output aliases, cache corruption recovery and channel-layout cache separation.
- No runtime/build/lint failures remain in executed checks. No build or lint script exists in this baseline; those checks were not run. CI's Node 22 environment was not run locally.
- Deferred verification: real denoising quality, LUFS/true-peak standards conformance, source/output file and symlink inspection, abandoned derivative cleanup, decoding/resampling, Premiere integration, listening quality, persistent caches and production performance. These require provider/adapter integration and real reference fixtures.
- Changes: only packages/audio/, this Audio spec/plan, and root pnpm-lock.yaml. Core and Sync source/configuration remain unchanged. The original checkout's unrelated untracked files remain intact.
- Initial delivery: uncommitted isolated Audio worktree; no branch switch in the original checkout, commit, push, PR, or service call at that stage. The later integration is recorded in `2026-10-07-audio-dsp-integration.md`.

## Final rulings

- Use the existing local Core commit as the implementation baseline; integrating this package into main depends on integrating that Core branch too.
- Extend Audio-owned envelopes with clip/media identity and versioned serialization rather than widening Core's minimal AudioDecision schema.
- Preserve supplied channel labels/order and include them in cache identity. If labels are unknown, the engine can check count only; preserving order is then the provider's responsibility.
- DSP acoustic quality, filesystem aliases and Premiere behavior remain the adapter's responsibility. Test doubles are not evidence of those behaviors.
