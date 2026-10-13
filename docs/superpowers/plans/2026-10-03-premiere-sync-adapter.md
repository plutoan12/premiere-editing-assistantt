# Premiere Sync Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate canonical `SyncGroup` results into reviewable Premiere Pro UXP operations, enforce stale-state validation, and apply approved placements only to a dedicated sync sequence.

**Architecture:** Keep a pure `adapters/premiere` planning layer that depends on small host interfaces rather than importing Premiere at test time. Add a UXP host implementation under `apps/premiere-panel` using current official Premiere APIs: `Project.getActiveProject()`, `ProjectUtils.getSelection()`, `Project.createSequenceFromMedia()`, `SequenceEditor.createInsertProjectItemAction()`, `TickTime`, and `Project.executeTransaction()`. Dry-run snapshots project/sequence/media identity; Apply revalidates the snapshot and refuses stale or unsupported operations.

**Tech Stack:** TypeScript 5.9, pnpm, Vitest, Premiere Pro UXP 25.6+ API surface, `@pea/core`, `@pea/sync`.

**Spec:** `docs/superpowers/specs/2026-10-03-premiere-local-pipeline-design.md`

## Global Constraints
- No Premiere/UXP imports inside `packages/core` or `packages/sync`.
- Dry-run precedes Apply; Apply accepts only an approved dry-run token/snapshot.
- Project/sequence/media identity changes invalidate Apply.
- Review-required sync candidates do not generate placement operations unless explicitly resolved later.
- Never move/delete source files and never silently overwrite unrelated sequences.
- Unsupported host capability returns an explicit error.
- CI does not require Premiere; real Premiere apply is a separate manual gate.

## Review Focus
1. Negative canonical offsets must be rebased into a non-negative sequence origin without changing relative sync.
2. Sub-frame/sample offsets must follow one explicit frame quantization policy and surface the quantization error.
3. Renamed/relinked/replaced project items after dry-run must invalidate Apply when stable identity changes.
4. An existing unrelated sequence with the requested name must not be overwritten.
5. Partial Apply failure must report which operations were attempted/applied/not-applied and must not claim rollback.

---

### Task 1: Pure Premiere operation contracts and dry-run planner

**Files:**
- Create: `adapters/premiere/package.json`
- Create: `adapters/premiere/tsconfig.json`
- Create: `adapters/premiere/src/types.ts`
- Create: `adapters/premiere/src/sync-plan.ts`
- Create: `adapters/premiere/src/sync-plan.test.ts`
- Create: `adapters/premiere/src/index.ts`

**Interfaces:**
- Produces: `PremiereProjectSnapshot`, `PremiereSyncOperation`, `PremiereSyncDryRun`, `buildSyncDryRun(syncGroup, snapshot, options)`.

- [ ] Write RED tests for matched members only, negative-offset rebasing, deterministic track assignment, missing media ID, review-required exclusion, sequence-name collision, and explicit quantization warnings.
- [ ] Run targeted tests; expected RED.
- [ ] Implement a pure planner with no `premierepro` import.
- [ ] Quantize placements to the target sequence frame grid using a documented nearest-frame policy; record signed quantization error.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(premiere): plan sync operations without mutation`.

### Task 2: Stable project snapshot and stale-state validator

**Files:**
- Create: `adapters/premiere/src/state.ts`
- Create: `adapters/premiere/src/state.test.ts`

**Interfaces:**
- Produces: `hashProjectSnapshot(snapshot): string`; `validateApplySnapshot(dryRun, current): ApplyValidation`.

- [ ] Write RED tests for changed project GUID, target sequence GUID/settings, missing/replaced project item ID, changed media fingerprint/path identity, and unchanged state.
- [ ] Run targeted tests; expected RED.
- [ ] Implement deterministic snapshot hashing and explicit stale reasons.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(premiere): reject stale sync apply plans`.

### Task 3: Host capability interface and apply executor

**Files:**
- Create: `adapters/premiere/src/host.ts`
- Create: `adapters/premiere/src/apply.ts`
- Create: `adapters/premiere/src/apply.test.ts`

**Interfaces:**
- Produces: `PremiereHost` abstraction and `applySyncDryRun(host, dryRun): Promise<ApplyReport>`.

- [ ] Write RED tests for stale rejection before mutation, unsupported capability, dedicated sequence creation, ordered insert actions, partial failure reporting, and no overwrite of unrelated sequence.
- [ ] Run targeted tests; expected RED.
- [ ] Implement apply executor against the host abstraction; do not claim atomic rollback.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(premiere): apply approved sync operations`.

### Task 4: UXP Premiere host implementation

**Files:**
- Create: `apps/premiere-panel/package.json`
- Create: `apps/premiere-panel/tsconfig.json`
- Create: `apps/premiere-panel/src/premiere-host.ts`
- Create: `apps/premiere-panel/src/premiere-host.test.ts`
- Create: `apps/premiere-panel/src/premierepro.d.ts`

**Interfaces:**
- Consumes: `PremiereHost`.
- Produces: `createPremiereUxpHost(ppro): PremiereHost`.

- [ ] Write contract tests with a fake Premiere module mirroring only official calls used by the adapter.
- [ ] Run targeted tests; expected RED.
- [ ] Implement project/selection discovery with `Project.getActiveProject()` and `ProjectUtils.getSelection()`; use `ProjectItem.getId()` for stable item identity.
- [ ] Implement sequence creation with `Project.createSequenceFromMedia()`; placements use `SequenceEditor.getEditor()`, `createInsertProjectItemAction()`, `TickTime.createWithSeconds/createWithTicks`, and `Project.executeTransaction()`.
- [ ] Keep current official API usage isolated in this file so future Premiere API changes do not leak into the pure adapter.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(premiere): bridge sync adapter to UXP API`.

### Task 5: Helper client orchestration boundary for the panel

**Files:**
- Create: `apps/premiere-panel/src/sync-controller.ts`
- Create: `apps/premiere-panel/src/sync-controller.test.ts`

**Interfaces:**
- Consumes: selected Premiere items, native-helper client, `syncClips`, dry-run/apply adapter.
- Produces: `analyzeSync()`, `dryRunSync()`, `applyApprovedSync()`, `cancelSync()`.

- [ ] Write RED state tests for helper unavailable, Auto/Timecode/Audio/Playback modes, progress polling, cancel, review-required result, dry-run, stale Apply, and successful Apply report.
- [ ] Run targeted tests; expected RED.
- [ ] Implement orchestration only; no visual polish in this task.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(panel): orchestrate local sync workflow`.

### Task 6: Minimal UXP Sync panel shell and manual Premiere gate

**Files:**
- Create: `apps/premiere-panel/manifest.json`
- Create: `apps/premiere-panel/index.html`
- Create: `apps/premiere-panel/src/main.ts`
- Create: `apps/premiere-panel/README.md`
- Create: `docs/acceptance/premiere-sync-apply-checklist.md`

**Interfaces:**
- Produces: one Sync panel flow: helper status → selected items → mode → Analyze → results → Dry Run → explicit Apply.

- [ ] Add a minimal panel that exposes only implemented Sync states; do not expose unfinished modules.
- [ ] Set Premiere host minimum to 25.6 for the UXP API calls used; document that Hybrid native addons are not required by this HTTP-helper design.
- [ ] Document Developer Mode/UDT load, disposable project copy, dry-run inspection, Apply, resulting sequence inspection, relaunch/reconnect, and uninstall/cleanup.
- [ ] Run full `pnpm test && pnpm typecheck`; expected PASS.
- [ ] Verify source tree contains no Adobe sample source copied verbatim; official samples are reference-only unless their license permits reuse.
- [ ] Commit: `feat(panel): add reviewable Premiere sync shell`.

### Task 7: Final integration verification

**Files:**
- Modify: root `README.md`
- Create: `docs/acceptance/ffmpeg-to-premiere-sync-status.md`

- [ ] Run generated-container FFmpeg integration through helper → sync engine → Premiere pure dry-run fixture.
- [ ] Run full workspace tests/typecheck.
- [ ] Verify `packages/sync` has zero Premiere/UXP/HTTP/process imports.
- [ ] Record manual gates separately: permitted real footage, Premiere disposable-copy Apply, install/relaunch/uninstall.
- [ ] Commit: `docs: record ffmpeg to Premiere sync verification`.
