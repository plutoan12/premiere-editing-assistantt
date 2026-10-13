# Real-Media Sync Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the FFmpeg-backed sync pipeline against generated containers and user-owned/permitted camera/recorder footage without committing footage, and produce inspectable expected-vs-measured reports.

**Architecture:** Add a CLI acceptance harness under `apps/sync-validation`. It consumes a local manifest containing media paths plus manually recorded reference offsets, calls the native helper and canonical `@pea/sync`, and writes JSON + Markdown reports containing fingerprints and measurements but no copied footage. Generated fixtures run in CI; real footage remains a manual/local release gate.

**Tech Stack:** TypeScript 5.9, Node 22, pnpm, Vitest, native helper HTTP client, `@pea/sync`.

**Spec:** `docs/superpowers/specs/2026-10-03-premiere-local-pipeline-design.md`

## Global Constraints
- Never commit production/user footage or absolute local media paths.
- Reports record fingerprints, versions, config, expected offset, measured offset, error, evidence/status, and pass/fail.
- Do not advertise an accuracy percentage from a tiny or unrepresentative set.
- Review-required output is a valid measured outcome, not silently coerced into a pass.
- Real-media harness is read-only with respect to source media.

## Review Focus
1. Missing/deleted media in a manifest must fail that case without aborting unrelated cases.
2. A changed file with the same filename must be detected by fingerprint mismatch.
3. Expected offsets with negative placement must preserve sign.
4. Review-required ambiguity must appear as review, never as zero-error match.
5. Reports must redact full local paths by default.

---

### Task 1: Validation manifest and report contracts

**Files:**
- Create: `apps/sync-validation/package.json`
- Create: `apps/sync-validation/tsconfig.json`
- Create: `apps/sync-validation/src/types.ts`
- Create: `apps/sync-validation/src/types.test.ts`

**Interfaces:**
- Produces: `ValidationManifest`, `ValidationCase`, `ValidationReport`, `ValidationCaseResult`; expected offset represented as signed bigint samples plus sample rate.

- [ ] Write RED schema tests for negative offsets, duplicate case IDs, missing reference/target paths, invalid tolerances, and optional expected fingerprints.
- [ ] Run targeted tests; expected RED.
- [ ] Implement contracts and validation.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(validation): define sync acceptance contracts`.

### Task 2: Read-only runner and per-case isolation

**Files:**
- Create: `apps/sync-validation/src/run.ts`
- Create: `apps/sync-validation/src/run.test.ts`

**Interfaces:**
- Consumes: `createHelperAudioProvider`, `syncClips`, manifest.
- Produces: `runValidation(manifest, options): Promise<ValidationReport>`.

- [ ] Write RED tests for successful signed-offset measurement, missing file isolated to one case, review-required result, helper failure, and expected fingerprint mismatch.
- [ ] Run targeted tests; expected RED.
- [ ] Implement per-case probe/fingerprint/sync with no writes to source paths.
- [ ] Compute `errorSamples = measured - expected`; pass only matched results within configured absolute tolerance.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(validation): run expected-vs-measured sync cases`.

### Task 3: JSON/Markdown report writer and CLI

**Files:**
- Create: `apps/sync-validation/src/report.ts`
- Create: `apps/sync-validation/src/report.test.ts`
- Create: `apps/sync-validation/src/cli.ts`
- Create: `apps/sync-validation/README.md`

**Interfaces:**
- Produces: `writeValidationReport(report, outDir)`; CLI `pea-sync-validate --manifest <file> --out <dir>`.

- [ ] Write RED tests that reports include engine/helper/protocol versions, fingerprints, expected/measured/error, confidence/evidence/reason/status, while omitting full paths by default.
- [ ] Run targeted tests; expected RED.
- [ ] Implement deterministic JSON and Markdown output; add explicit `--include-paths` opt-in only for local debugging.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(validation): write inspectable sync reports`.

### Task 4: Generated fixture matrix in CI

**Files:**
- Create: `tests/fixtures/generate-media.ts`
- Create: `tests/ffmpeg/validation-matrix.integration.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: tiny generated containers covering WAV/MOV/MP4 where available, exact positive/negative offsets, head silence, gain difference, no-audio, and periodic ambiguity.

- [ ] Write the integration assertions before fixture generator implementation; expected RED.
- [ ] Generate fixtures at test runtime with system FFmpeg; never commit binaries.
- [ ] Assert exact/near-exact cases <= 1 sample where encoding is lossless; lossy container cases use an explicitly documented tolerance and must not be mixed into the exact gate.
- [ ] Assert no-audio and periodic fixtures return structured error/review outcomes.
- [ ] Run full workspace tests/typecheck in CI; expected PASS.
- [ ] Commit: `test(validation): add generated media acceptance matrix`.

### Task 5: Permitted real-footage workflow

**Files:**
- Create: `apps/sync-validation/examples/manifest.example.json`
- Create: `docs/acceptance/real-media-sync-checklist.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: local-only workflow for camera scratch audio + external recorder/playback master with manual reference sync point.

- [ ] Add ignore rules for local manifests, media, and generated reports while keeping examples/docs tracked.
- [ ] Document how to record a manual clap/slate/reference offset, run the helper + CLI, and inspect matched/review/error outcomes.
- [ ] Require at least camera+recorder and playback-take categories before any product accuracy claim.
- [ ] Run a repository scan confirming no media files or absolute user paths were added.
- [ ] Commit: `docs(validation): add real footage acceptance workflow`.
