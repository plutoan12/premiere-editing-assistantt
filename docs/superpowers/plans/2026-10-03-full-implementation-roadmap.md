# Premiere Editing Assistant — Detailed Implementation Roadmap

> **For agentic workers:** Execute module plans in order. Use TDD and keep NLE-specific behavior inside adapters.

**Goal:** Deliver a usable Premiere-first editing assistant while preserving reusable Core engines for Final Cut Pro and DaVinci Resolve.

**Architecture:** `@pea/core` defines canonical contracts. Seven engine packages consume/produce those contracts. `adapters/premiere` performs only Premiere translation. `apps/premiere-panel` orchestrates workflows and presents review/approval UI.

**Tech Stack:** Node.js 22+, TypeScript, pnpm workspaces, Vitest, Zod, FFmpeg/ffprobe integration through provider boundaries, Premiere adapter APIs/formats as applicable.

**Spec:** `docs/superpowers/specs/2026-10-03-premiere-editing-assistant-platform-design.md`

## Delivery Order

### Phase 0 — Core
Status: implementation underway on `feat/core-contracts`.
Deliverables: exact rational media time, canonical project/media/transcript/edit contracts, jobs/artifacts, provider interfaces, validation.

### Phase 1 — Sync Engine
**Input:** MediaAsset/ClipReference plus timecode/audio/playback evidence.
**Output:** SyncGroup + confidence + evidence/provenance.
**Features:** timecode sync, waveform correlation, multicam grouping, playback/music alignment, subtitle/dub alignment hooks, re-sync mapping.
**Files:** `packages/sync/src/{types,strategy,timecode,audio,multicam,playback,resync,index}.ts`.
**Done when:** synthetic offset fixtures align within configured tolerance; ambiguous matches are never silently accepted.

### Phase 2 — Media Organizer
**Input:** MediaAsset + probe/STT/vision metadata.
**Output:** canonical tags, bin plans, searchable index documents.
**Features:** ffprobe metadata normalization, deterministic bins, scene/take grouping, semantic tags, people/speech tags, query API.
**Files:** `packages/media-organizer/src/{probe,normalize,bins,scene-take,tags,search,index}.ts`.
**Done when:** a mixed camera fixture produces stable bins/tags on repeated runs and AI enrichment can be disabled.

### Phase 3 — Subtitle Engine
**Input:** media/audio + STT provider.
**Output:** Transcript and caption decisions.
**Features:** STT orchestration, diarization mapping, segmentation, timing refinement, text correction, translation/localization.
**Files:** `packages/subtitle/src/{stt,speakers,segment,timing,correction,translation,index}.ts`; prompts under `prompts/subtitle/`.
**Done when:** provider output becomes deterministic canonical transcript artifacts and translations preserve segment lineage.

### Phase 4 — Rough Cut Engine
**Input:** Transcript, tags, sync groups, editorial constraints.
**Output:** SequencePlan proposals.
**Features:** silence detection, NG/duplicate candidate detection, selects, transcript-based edit decisions, rough sequence assembly.
**Files:** `packages/rough-cut/src/{silence,ng,selects,transcript-edit,sequence,index}.ts`; prompts under `prompts/rough-cut/`.
**Done when:** every generated cut cites source clip/time range and can be rejected/edited without touching source media.

### Phase 5 — Graphics Engine
**Input:** Transcript/AnalysisTag/SequencePlan + template catalog.
**Output:** GraphicDecision[].
**Features:** MOGRT catalog, caption style rules, semantic template recommendation, safe placement, collision rules.
**Files:** `packages/graphics/src/{catalog,rules,caption,placement,index}.ts`; prompts under `prompts/graphics/`.
**Done when:** deterministic rules work without AI and AI recommendations never reference unavailable templates.

### Phase 6 — Audio Engine
**Input:** timeline audio analysis + SequencePlan.
**Output:** AudioDecision[].
**Features:** dialogue level analysis, cleanup recommendations, BGM ducking envelopes, beat/onset markers, loudness measurement.
**Files:** `packages/audio/src/{dialogue,cleanup,ducking,beats,loudness,index}.ts`.
**Done when:** analysis is non-destructive and target loudness/ducking decisions are reproducible from identical inputs.

### Phase 7 — Delivery Engine
**Input:** approved master SequencePlan + localization assets.
**Output:** DeliveryVariant[] and export jobs.
**Features:** aspect variants, reframe decisions, localization inheritance, naming/versioning, export manifests.
**Files:** `packages/delivery/src/{variants,reframe,localization,versioning,export,index}.ts`; prompts under `prompts/localization/`.
**Done when:** one approved master can generate validated 16:9/9:16 variants without mutating the master.

### Phase 8 — Premiere Adapter
**Input:** canonical Core decisions.
**Output:** Premiere project operations/importable representation.
**Features:** project/media ID mapping, bins, markers, sequences, captions, MOGRT refs, audio decisions, export handoff.
**Files:** `adapters/premiere/src/{project-map,bins,markers,sequences,captions,graphics,audio,export,index}.ts`.
**Done when:** adapter contract tests prove engines have zero Premiere imports and a fixture project round-trips stable IDs.

### Phase 9 — Premiere Panel
**Workflow:** Ingest → Sync → Organize → Subtitle → Rough Cut → Graphics/Audio → Delivery.
**UX rule:** destructive actions are absent; AI/editorial proposals expose review before applying.
**Files:** `apps/premiere-panel/`.
**Done when:** a user can run each engine independently or execute the staged pipeline while seeing job status/errors.

## Cross-cutting requirements
- Cache keys include media fingerprint + config + provider/model/prompt version.
- Long jobs are cancellable and retry-safe.
- Failed candidates never replace last valid artifacts.
- Every AI artifact records provenance and prompt/model version.
- No API key in git.
- No production footage in git.
- All modules expose public interfaces from their package root.
- CI runs tests and typecheck for all workspaces.

## Release Gates
**Alpha:** Core + Sync + Organizer + Premiere adapter can ingest, organize and sync a real small project.
**Beta:** Subtitle + Rough Cut + Graphics + Audio operate through reviewable proposals.
**v1:** Delivery/localization, recovery, caching, installer/panel polish and end-to-end fixture tests are green.
