# Core Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the NLE-independent canonical data contracts, exact time model, job/artifact lifecycle and provider boundaries required by every editing engine.

**Architecture:** Implement Core as a small TypeScript package with runtime validation. JSON Schema mirrors public serialized contracts. Engines depend on Core only; Core has no Premiere or vendor SDK imports.

**Tech Stack:** TypeScript, Node.js 22+, pnpm workspaces, Vitest, Zod, JSON Schema (generated from Zod, never hand-maintained), ESLint with import-boundary rules, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-03-premiere-editing-assistant-platform-design.md`

## Global Constraints
- Core must remain NLE-independent.
- No source-media mutation or deletion.
- Every time-bearing value carries an explicit rational timebase/frame-rate.
- No silent frame-rate conversion.
- Serialized public contracts are versioned.
- Provider SDKs may not leak into Core types.
- Secrets are never committed.
- Layer boundaries (`packages/*` never import `adapters/*` or `apps/*`; `packages/core` imports no other workspace package) are enforced by lint in CI.
- Canonical `MediaTime` never carries drop-frame; drop-frame belongs to `Timecode` only.
- Rational arithmetic across timebases uses BigInt or reduce-then-guard; nothing may silently exceed 2^53.
- JSON Schema files under `schemas/` are generated from the Zod definitions and checked for drift by a test.

## Review Focus
1. NTSC fractional rates such as 24000/1001 and 30000/1001 must round-trip without floating-point drift.
2. Drop-frame/non-drop-frame identity must not be silently changed.
3. Invalid negative durations or out-of-range edit decisions must fail validation.
4. Retried jobs must not replace the last valid artifact with a failed output.
5. Unknown future schema versions must fail explicitly rather than being interpreted as the current version. Same-major, lower-or-equal-minor documents must be accepted; different-major or higher-minor documents must be rejected with `UnsupportedSchemaVersion`.
6. Cross-timebase comparison (e.g. 24000/1001 vs 48000/1) at tick values near 2^53 must stay exact; no intermediate may overflow the safe-integer range.
7. A retry must create a new Job with `retryOf` and `attempt + 1` (first run is attempt 0); terminal Jobs must have no outgoing transitions.
8. Artifact promotion must be atomic and must never let a `rejected` candidate or a failed Job's output replace `current`.

---

### Task 1: Workspace and Core package foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/version.ts`
- Create: `.nvmrc` (Node 22) and `packageManager` field in root `package.json`
- Create: `vitest.workspace.ts` (covers `packages/*` and root `tests/`)
- Create: `eslint.config.js` with import-boundary rules (`no-restricted-imports` or dependency-cruiser)
- Create: `.github/workflows/ci.yml` (lint, typecheck, test on push and pull request)
- Test: `packages/core/src/version.test.ts`

**Interfaces:**
- Produces: `CORE_SCHEMA_VERSION: "1.0.0"`

- [ ] Write a failing test asserting `CORE_SCHEMA_VERSION === "1.0.0"`.
- [ ] Run `pnpm --filter @pea/core test`; verify failure before implementation.
- [ ] Add minimal workspace/Core configuration and export `CORE_SCHEMA_VERSION`.
- [ ] Add boundary lint rules: `packages/*` may not import `adapters/*` or `apps/*`; `packages/core` may not import any other workspace package or vendor SDK. Add a fixture file that violates the rule and confirm lint fails, then remove it.
- [ ] Add the CI workflow running `pnpm lint`, `pnpm typecheck` and `pnpm test`.
- [ ] Run Core tests and TypeScript typecheck; verify success.
- [ ] Commit as `chore: initialize core workspace`.

### Task 2: Exact time and frame-rate model

**Files:**
- Create: `packages/core/src/time.ts`
- Create: `packages/core/src/timecode.ts`
- Test: `packages/core/src/time.test.ts`
- Test: `packages/core/src/timecode.test.ts`

**Interfaces:**
- Produces: `Rational`, `FrameRate`, `MediaTime`, `TimeRange`, `compareMediaTime(a,b)`, `convertMediaTime(t, timebase)`, `validateTimeRange(range)`
- Produces: `Timecode` (`{ frames, frameRate, dropFrame }`), `toTimecode(mediaTime, frameRate, dropFrame)`, `fromTimecode(timecode)`

- [ ] Write failing tests for 24/1, 24000/1001, 30000/1001 rational construction and reduction, exact comparison and negative-duration rejection.
- [ ] Write failing tests for cross-timebase comparison and conversion with tick values near 2^53 (e.g. 24000/1001 vs 48000/1), asserting exactness and explicit rejection of out-of-range inputs.
- [ ] Write failing tests for `Timecode`: drop-frame and non-drop-frame identity is preserved through `toTimecode`/`fromTimecode` round-trips; `MediaTime` has no drop-frame field.
- [ ] Run the time tests and verify failure.
- [ ] Implement integer/rational time types using BigInt (or reduce-then-guard) internally, without storing canonical time as floating-point seconds.
- [ ] Implement `Timecode` as a display type separate from `MediaTime`.
- [ ] Run tests and typecheck; verify success.
- [ ] Commit as `feat: add exact media time model`.

### Task 3: Canonical project and media contracts

**Files:**
- Create: `packages/core/src/ids.ts`
- Create: `packages/core/src/project.ts`
- Create: `packages/core/src/media.ts`
- Create: `packages/core/src/sync.ts`
- Test: `packages/core/src/ids.test.ts`
- Test: `packages/core/src/project.test.ts`
- Test: `packages/core/src/media.test.ts`
- Test: `packages/core/src/sync.test.ts`

**Interfaces:**
- Produces: `EntityId` (UUID v7), `newEntityId()`, `Project`, `MediaAsset`, `ClipReference`, `MediaFingerprint`, `SyncGroup`

- [ ] Write failing tests for UUID v7 IDs (format, time-ordering, never derived from paths or NLE ids), source immutability metadata, explicit frame rate and invalid clip ranges.
- [ ] Write failing tests for `SyncGroup`: members reference existing `MediaAsset` ids, each member carries an explicit offset as `MediaTime`, a group needs at least two members, and a designated reference member.
- [ ] Run tests and verify failure.
- [ ] Implement id, project, media and sync contracts using the Task 2 time model.
- [ ] Run tests and typecheck; verify success.
- [ ] Commit as `feat: add project and media contracts`.

### Task 4: Transcript and analysis contracts

**Files:**
- Create: `packages/core/src/transcript.ts`
- Create: `packages/core/src/analysis.ts`
- Test: `packages/core/src/transcript.test.ts`
- Test: `packages/core/src/analysis.test.ts`

**Interfaces:**
- Produces: `Transcript`, `TranscriptSegment`, `Speaker`, `AnalysisTag`, `Provenance`, `Confidence`

- [ ] Write failing tests for ordered segments, media-bound time ranges, confidence bounds and provenance metadata.
- [ ] Run tests and verify failure.
- [ ] Implement transcript/analysis contracts without provider-specific fields.
- [ ] Run tests and typecheck; verify success.
- [ ] Commit as `feat: add transcript and analysis contracts`.

### Task 5: Editorial decision contracts

**Files:**
- Create: `packages/core/src/edit.ts`
- Test: `packages/core/src/edit.test.ts`

**Interfaces:**
- Produces: `EditDecision`, `SequencePlan`, `GraphicDecision`, `AudioDecision`, `DeliveryVariant`

- [ ] Write failing tests for source references, destination placement, invalid ranges and non-destructive edit semantics.
- [ ] Run tests and verify failure.
- [ ] Implement canonical editorial decision types independent of Premiere track APIs.
- [ ] Run tests and typecheck; verify success.
- [ ] Commit as `feat: add editorial decision contracts`.

### Task 6: Job and artifact lifecycle

**Files:**
- Create: `packages/core/src/jobs.ts`
- Create: `packages/core/src/artifacts.ts`
- Test: `packages/core/src/jobs.test.ts`
- Test: `packages/core/src/artifacts.test.ts`

**Interfaces:**
- Produces: `Job` (with `retryOf?`, `attempt`, `results: JobItemResult[]`), `JobStatus` (`queued | running | completed | failed | cancelled`), `JobItemResult` (`succeeded | failed | skipped` with reason), `canTransitionJob(from,to)`, `createRetry(job)`
- Produces: `Artifact` (with `cacheKey`, `provenance`), `ArtifactStatus` (`candidate | validated | current | superseded | rejected`), `ArtifactProvenance` (module/version, provider/model version, prompt id/version, input fingerprints, config hash), `promoteArtifact(candidate,current)`, `deriveCacheKey(provenance)`

- [ ] Write failing tests for every legal transition listed in the spec and for rejection of every other pair, including that terminal states have no outgoing transitions.
- [ ] Write failing tests that `createRetry` returns a new Job with `retryOf` and `attempt + 1` and leaves the original untouched; that cancellation is allowed from `queued` and `running`.
- [ ] Write failing tests that partial success is expressed through `results` on a `completed` Job, not through a separate status.
- [ ] Write failing tests that `promoteArtifact` only accepts a `validated` candidate, marks the previous `current` as `superseded`, and refuses `candidate`/`rejected` inputs so a failed output never replaces `current`.
- [ ] Write failing tests that `deriveCacheKey` is stable for equal provenance and changes when any model, prompt, config or fingerprint input changes.
- [ ] Run tests and verify failure.
- [ ] Implement lifecycle state machines and immutable artifact promotion rules.
- [ ] Run tests and typecheck; verify success.
- [ ] Commit as `feat: add job and artifact lifecycle`.

### Task 7: Provider capability interfaces

**Files:**
- Create: `packages/core/src/providers.ts`
- Test: `packages/core/src/providers.test.ts`

**Interfaces:**
- Produces: `SttProvider`, `VisionProvider`, `LlmProvider`, `TranslationProvider`, `MediaProbeProvider`
- Consumes: canonical Core inputs/outputs only.

- [ ] Write compile-time/mock tests proving provider implementations can satisfy interfaces without vendor types entering consumers.
- [ ] Run tests and verify failure.
- [ ] Implement capability interfaces with abort/cancellation and version metadata.
- [ ] Run tests and typecheck; verify success.
- [ ] Commit as `feat: define provider capability interfaces`.

### Task 8: Serialized schemas and contract validation

**Files:**
- Create: `schemas/v1/project.schema.json`
- Create: `schemas/v1/media.schema.json`
- Create: `schemas/v1/sync.schema.json`
- Create: `schemas/v1/transcript.schema.json`
- Create: `schemas/v1/analysis.schema.json`
- Create: `schemas/v1/edit.schema.json`
- Create: `schemas/v1/job.schema.json`
- Create: `schemas/v1/artifact.schema.json`
- Create: `packages/core/scripts/generate-schemas.ts` (Zod -> JSON Schema)
- Create: `packages/core/src/validation.ts`
- Test: `packages/core/src/validation.test.ts`
- Test: `packages/core/src/schema-drift.test.ts`

**Interfaces:**
- Produces: `parseCoreDocument(input)`, `CoreValidationError`, `UnsupportedSchemaVersion`, `isSchemaVersionSupported(version)`

- [ ] Write failing tests for valid v1 documents, malformed time values, tick/timebase values outside the safe-integer range, and missing `schemaVersion`.
- [ ] Write failing tests for the compatibility policy: same major with lower-or-equal minor is accepted; different major or higher minor is rejected with `UnsupportedSchemaVersion` naming both versions; patch is ignored.
- [ ] Write a failing drift test that regenerates JSON Schema from the Zod definitions and asserts it equals the committed `schemas/v1/*.json`.
- [ ] Run tests and verify failure.
- [ ] Add the generator script, generate the v1 schemas, and add runtime parsing with actionable validation errors.
- [ ] Run tests and typecheck; verify success.
- [ ] Commit as `feat: add versioned core schema validation`.

### Task 9: Core public API and contract smoke test

**Files:**
- Modify: `packages/core/src/index.ts`
- Create: `tests/core-contract-smoke.test.ts` (picked up by the Task 1 Vitest workspace)
- Create: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: stable `@pea/core` public exports consumed by all later engines.

- [ ] Write a failing smoke test that creates a Project, MediaAsset, SyncGroup, Transcript, SequencePlan, Job and Artifact exclusively through public exports.
- [ ] Run the smoke test and verify failure.
- [ ] Export the intended Core surface, document safety/architecture rules, and add an empty safe environment template.
- [ ] Run `pnpm test` and `pnpm typecheck`; verify all pass.
- [ ] Commit as `feat: establish core public contract`.

## Completion Gate
Core is complete only when every later engine can model its inputs and outputs without importing Premiere APIs, vendor SDK types, floating-point canonical timestamps or another engine's private state.
