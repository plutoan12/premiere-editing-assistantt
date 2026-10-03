# Core Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the NLE-independent canonical data contracts, exact time model, job/artifact lifecycle and provider boundaries required by every editing engine.

**Architecture:** Implement Core as a small TypeScript package with runtime validation. JSON Schema mirrors public serialized contracts. Engines depend on Core only; Core has no Premiere or vendor SDK imports.

**Tech Stack:** TypeScript, Node.js 22+, pnpm workspaces, Vitest, Zod, JSON Schema.

**Spec:** `docs/superpowers/specs/2026-10-03-premiere-editing-assistant-platform-design.md`

## Global Constraints
- Core must remain NLE-independent.
- No source-media mutation or deletion.
- Every time-bearing value carries an explicit rational timebase/frame-rate.
- No silent frame-rate conversion.
- Serialized public contracts are versioned.
- Provider SDKs may not leak into Core types.
- Secrets are never committed.

## Review Focus
1. NTSC fractional rates such as 24000/1001 and 30000/1001 must round-trip without floating-point drift.
2. Drop-frame/non-drop-frame identity must not be silently changed.
3. Invalid negative durations or out-of-range edit decisions must fail validation.
4. Retried jobs must not replace the last valid artifact with a failed output.
5. Unknown future schema versions must fail explicitly rather than being interpreted as the current version.

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
- Test: `packages/core/src/version.test.ts`

**Interfaces:**
- Produces: `CORE_SCHEMA_VERSION: "1.0.0"`

- [ ] Write a failing test asserting `CORE_SCHEMA_VERSION === "1.0.0"`.
- [ ] Run `pnpm --filter @pea/core test`; verify failure before implementation.
- [ ] Add minimal workspace/Core configuration and export `CORE_SCHEMA_VERSION`.
- [ ] Run Core tests and TypeScript typecheck; verify success.
- [ ] Commit as `chore: initialize core workspace`.

### Task 2: Exact time and frame-rate model

**Files:**
- Create: `packages/core/src/time.ts`
- Test: `packages/core/src/time.test.ts`

**Interfaces:**
- Produces: `Rational`, `FrameRate`, `MediaTime`, `TimeRange`, `compareMediaTime(a,b)`, `validateTimeRange(range)`

- [ ] Write failing tests for 24/1, 24000/1001, 30000/1001, drop-frame identity, exact comparison and negative-duration rejection.
- [ ] Run the time tests and verify failure.
- [ ] Implement integer/rational time types and validation without storing canonical time as floating-point seconds.
- [ ] Run tests and typecheck; verify success.
- [ ] Commit as `feat: add exact media time model`.

### Task 3: Canonical project and media contracts

**Files:**
- Create: `packages/core/src/project.ts`
- Create: `packages/core/src/media.ts`
- Test: `packages/core/src/project.test.ts`
- Test: `packages/core/src/media.test.ts`

**Interfaces:**
- Produces: `Project`, `MediaAsset`, `ClipReference`, `MediaFingerprint`

- [ ] Write failing tests for stable IDs, source immutability metadata, explicit frame rate and invalid clip ranges.
- [ ] Run tests and verify failure.
- [ ] Implement project/media contracts using the Task 2 time model.
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
- Produces: `Job`, `JobStatus`, `Artifact`, `ArtifactStatus`, `canTransitionJob(from,to)`, `promoteArtifact(candidate,current)`

- [ ] Write failing tests for legal/illegal job transitions, cancellation, retry metadata and failed-candidate artifact preservation.
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
- Create: `schemas/v1/transcript.schema.json`
- Create: `schemas/v1/edit.schema.json`
- Create: `schemas/v1/job.schema.json`
- Create: `packages/core/src/validation.ts`
- Test: `packages/core/src/validation.test.ts`

**Interfaces:**
- Produces: `parseCoreDocument(input)`, `CoreValidationError`

- [ ] Write failing tests for valid v1 documents, malformed time values and explicit rejection of unsupported schema versions.
- [ ] Run tests and verify failure.
- [ ] Add v1 schemas and runtime parsing with actionable validation errors.
- [ ] Run tests and typecheck; verify success.
- [ ] Commit as `feat: add versioned core schema validation`.

### Task 9: Core public API and contract smoke test

**Files:**
- Modify: `packages/core/src/index.ts`
- Create: `tests/core-contract-smoke.test.ts`
- Create: `.env.example`
- Create: `README.md`

**Interfaces:**
- Produces: stable `@pea/core` public exports consumed by all later engines.

- [ ] Write a failing smoke test that creates a Project, MediaAsset, Transcript, SequencePlan, Job and Artifact exclusively through public exports.
- [ ] Run the smoke test and verify failure.
- [ ] Export the intended Core surface, document safety/architecture rules, and add an empty safe environment template.
- [ ] Run `pnpm test` and `pnpm typecheck`; verify all pass.
- [ ] Commit as `feat: establish core public contract`.

## Completion Gate
Core is complete only when every later engine can model its inputs and outputs without importing Premiere APIs, vendor SDK types, floating-point canonical timestamps or another engine's private state.
