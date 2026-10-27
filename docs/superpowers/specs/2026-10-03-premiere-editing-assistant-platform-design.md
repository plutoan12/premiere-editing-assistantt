# Premiere Editing Assistant Platform Design

**Date:** 2026-10-03
**Status:** Approved architecture baseline
**Revision:** 2026-10-27 — review fixes (job state machine, schema compatibility policy, time/timecode split, artifact lifecycle, identity, open decisions)

## Goal
Build a modular post-production automation platform with Premiere Pro as the first NLE integration. Repetitive editorial work is automated while final creative judgment stays with the editor.

## Product Modules
1. **Sync Engine** — multicam, audio/video, music/playback, subtitle, dubbing and re-sync.
2. **Media Organizer** — media analysis, Auto Bin, metadata, scene/take detection, person/speech tagging and AI search.
3. **Subtitle Engine** — STT, speaker detection, timing refinement, correction and translation.
4. **Rough Cut Engine** — silence/NG detection, selects, transcript editing and rough sequence generation.
5. **Graphics Engine** — MOGRT integration, caption styling, graphic rules and automatic placement.
6. **Audio Engine** — dialogue analysis, cleanup orchestration, BGM/ducking, beat detection and loudness.
7. **Delivery Engine** — reframe, localization, versioning and export orchestration.

## Architecture
The system has four layers:

- **Core:** canonical project, media, time, transcript, analysis, edit-decision, artifact and job models.
- **Engines:** seven NLE-independent workflows.
- **Adapters:** translate canonical data to/from an NLE. Premiere is the first adapter.
- **App:** Premiere-facing UI and orchestration.

No engine may import Premiere-specific code. Premiere behavior belongs under `adapters/premiere`.

Layer boundaries are enforced by lint rules in CI, not by convention alone:
- `packages/*` may not import from `adapters/*` or `apps/*`.
- `packages/core` may not import from any other workspace package or any provider/vendor SDK.
- `adapters/*` may import `packages/core` and engine public APIs only.

## Canonical Contracts
Modules communicate through versioned schemas, never by reading another module's private state.

Minimum entities:
- Project
- MediaAsset
- ClipReference
- TimeRange
- SyncGroup
- Transcript / TranscriptSegment
- Speaker
- AnalysisTag
- EditDecision
- SequencePlan
- GraphicDecision
- AudioDecision
- DeliveryVariant
- Job
- Artifact

All time-bearing entities preserve explicit frame-rate/timebase data. Silent frame-rate conversion is forbidden.

### Time model
Canonical time is `MediaTime = { ticks: integer, timebase: Rational }`. Canonical time is never stored as floating-point seconds.

Drop-frame is a property of a `Timecode` display value (`{ frames, frameRate, dropFrame }`), never of `MediaTime`. Converting `MediaTime` to `Timecode` requires an explicit frame rate and drop-frame flag; converting back must round-trip exactly.

Rational arithmetic across different timebases (comparison, conversion) must use BigInt internally, or reduce operands to lowest terms and guard every intermediate against the 2^53 safe-integer range. Serialized tick values are JSON integers; a document whose tick or timebase values exceed the safe-integer range is rejected at validation.

### Identity
Every entity carries a stable `id` string generated as UUID v7 (time-ordered, globally unique). IDs are never derived from file paths or NLE-internal IDs; those are stored as separate adapter-owned references on the entity.

### Schema versioning
Every serialized document carries `schemaVersion` as a semver string. A parser built for version `MAJOR.MINOR.x`:
- accepts documents with the same `MAJOR` and a `MINOR` less than or equal to its own;
- rejects documents with a different `MAJOR`, or a `MINOR` greater than its own, with an explicit `UnsupportedSchemaVersion` error that names both versions. Unknown versions are never interpreted as the current version;
- treats `PATCH` as non-structural and ignores it for compatibility checks.

Breaking changes bump `MAJOR` and ship together with a migration from the previous `MAJOR`.

## Processing Model
Long-running work is modelled as a `Job` with the following states:

`queued -> running -> completed | failed | cancelled`

Legal transitions:
- `queued -> running`
- `queued -> cancelled`
- `running -> completed`
- `running -> failed`
- `running -> cancelled`

`completed`, `failed` and `cancelled` are terminal. No transition leaves a terminal state.

Retry never re-opens a terminal Job. A retry creates a new Job that records `retryOf` (the previous job id) and `attempt` (1-based). The previous Job and any outputs it produced stay unchanged.

Cancellation is cooperative: a running Job receives an abort signal, must stop promptly, and must reach `cancelled` without promoting partially written outputs.

Partial success is not a Job state. A Job that finishes its run reports `completed` and carries a per-item result list where each item is `succeeded`, `failed` or `skipped` with a reason. A Job reports `failed` only when it produced no usable output or hit an unrecoverable error.

Failures must not corrupt the last valid project state. Expensive outputs are stored as versioned artifacts and promoted only after validation.

### Artifact lifecycle
`candidate -> validated -> current -> superseded`, plus `rejected` for a candidate that fails validation.

- At most one artifact per `(project, kind, cacheKey)` is `current`.
- Promotion is atomic: a `validated` candidate becomes `current` and the previous `current` becomes `superseded` in one step.
- A `rejected` candidate, or the output of a `failed` or `cancelled` Job, never touches the `current` artifact.
- Every artifact records provenance: producing module and version, provider name and model version, prompt id and version when AI was involved, input media fingerprints and a configuration hash. `cacheKey` is derived from exactly those provenance inputs.

## Deterministic First
Prefer deterministic processing for timecode matching, waveform correlation, media probing, frame/time conversion, loudness, beat/onset analysis where suitable, naming and schema validation.

Use AI selectively for semantic tagging, transcript interpretation, selects, rough-cut semantic decisions, graphic/template recommendations and translation/localization.

AI outputs are proposals until validated against structured schemas.

## Provider Isolation
STT, LLM, translation, vision and media-processing providers live behind interfaces. Engines depend on capabilities rather than vendor SDKs.

## Prompt System
Prompts live under `prompts/` and are versioned separately from application logic. Each AI workflow owns its instruction prompt, task template, structured output schema and evaluation fixtures where practical. Generated artifacts record prompt/model versions.

## Cache and Cost Control
Cache deterministic and AI analysis using media/content fingerprints plus configuration/model/prompt versions. Do not repeat STT, vision, translation or embedding work when a valid artifact exists. Optional AI enrichment must support budget guards.

## Premiere Adapter
The adapter maps canonical entities to Premiere-compatible project operations/data, including media IDs, bins, metadata, markers, sequences, captions/titles, MOGRT references, edit decisions and export handoff.

It must not own sync algorithms, STT, semantic analysis or rough-cut logic.

## Failure and Safety Rules
- Never modify or delete source media.
- Preserve previous valid artifacts on failure.
- Support partial success at module boundaries.
- Record actionable error information.
- Validate paths, time ranges, frame rates and media references before NLE writes.
- Never commit secrets. Only `.env.example` may document environment variables.
- Do not commit large real production media. Common media extensions are git-ignored; test fixtures are generated at test time, never checked in.

## Testing
1. **Contract tests:** schemas, timebase rules and public module interfaces.
2. **Module tests:** algorithms, provider mocks and engine behavior.
3. **Adapter integration tests:** canonical decisions translate to expected Premiere representations.
4. **Small synthetic fixtures:** automated tests use tiny generated fixtures rather than production footage.

## Repository Shape
```text
apps/
  premiere-panel/
packages/
  core/
  sync/
  media-organizer/
  subtitle/
  rough-cut/
  graphics/
  audio/
  delivery/
adapters/
  premiere/
prompts/
  subtitle/
  rough-cut/
  graphics/
  localization/
schemas/
docs/
  superpowers/
    specs/
    plans/
tests/
```

## Implementation Order
1. Core contracts, time model and job/artifact model
2. Sync Engine
3. Media Organizer
4. Subtitle Engine
5. Rough Cut Engine
6. Graphics Engine
7. Audio Engine
8. Delivery Engine
9. Premiere panel integration and end-to-end hardening

Each engine receives its own implementation plan and remains independently testable.

## Open Decisions
- **Premiere host runtime (UXP vs CEP).** UXP has no Node.js runtime, so with UXP the engines must run in a local sidecar process and the panel talks to it over IPC/HTTP; CEP allows engines inside the panel process. The choice decides how Job progress, cancellation and artifacts cross the process boundary. It must be settled in an ADR before the Premiere adapter plan is written. Core contracts are transport-agnostic, so this decision does not block Core.

## Future NLEs
Final Cut Pro and DaVinci Resolve are future adapters. Supporting them must not require engine rewrites; incompatible contract changes require explicit schema versioning/migrations.

## Initial Non-goals
- Fully autonomous final creative editing
- Arbitrary VFX generation
- Replacing dedicated finishing/color systems
- Cloud collaboration
- Billing/marketplace
- Supporting every NLE in v1
