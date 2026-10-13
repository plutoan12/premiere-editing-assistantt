# Premiere Local Pipeline & Packaging Design

**Date:** 2026-10-03
**Status:** Approved design baseline
**Extends:** `docs/superpowers/specs/2026-10-03-premiere-editing-assistant-platform-design.md`

## Goal

Turn the existing NLE-independent Sync Engine into a locally runnable Premiere-first product without introducing required cloud infrastructure. Consolidate the competing Sync PR APIs, decode real media through a local native helper, validate synchronization against small real-media fixtures, and expose reviewable Sync operations through an Adobe UXP panel.

## Product Boundary

The product is split into three runtime boundaries:

1. **Premiere UXP Panel** — UI, Premiere project discovery, user approval, dry-run display, and explicit application of approved operations.
2. **Local Native Helper** — loopback HTTP service, FFmpeg/ffprobe process ownership, media decoding/probing, long-running job lifecycle, cancellation, and local artifact/cache management.
3. **Core + Engines** — NLE-independent canonical contracts and deterministic synchronization logic. These packages never import Premiere, UXP, FFmpeg process APIs, or HTTP server code.

Required cloud services: **none**.

## Sync PR Consolidation

PR #2 (`feat/sync-engine`) and PR #3 (`feat/sync-engine-implementation`) share Core commit `c76071568cfb469009fbbf973fd06fbaa78661f7` and implement the same Sync plan with divergent public contracts.

They must not both be merged independently.

Consolidation rules:

- Create one canonical `@pea/sync` public API before FFmpeg or UXP integration.
- Preserve exact rational/bigint time semantics and forbid silent frame-rate, DF/NDF, sample-rate, or clock-domain conversion.
- Preserve explicit review-required results for silence, ambiguity, missing evidence, repeated source regions, partial mapping, and unsupported retiming.
- Port useful regression coverage from both PRs rather than choosing a branch by test count.
- Keep audio decoding behind `AudioSampleProvider`; a fingerprint is never accepted as an alignment result.
- Preserve cancellation, immutable/snapshotted reference buffers, provenance, and source-media immutability.
- Close/supersede the losing PR only after the consolidated branch passes its own CI.

## Native Helper

### Process

The helper is a local executable started by the product/launcher. It binds only to `127.0.0.1` on an ephemeral port.

At startup it creates a cryptographically random session token. Every request except the health/bootstrap path requires the token. The service must reject requests with a missing or incorrect token and must not bind to `0.0.0.0` or a LAN interface.

The helper owns:

- FFmpeg and ffprobe executable discovery and invocation.
- File-path validation and media probing.
- PCM extraction/window scheduling for `AudioSampleProvider`.
- Long-running job state and cancellation.
- Temporary/cache files created by the helper.
- Structured logs that never contain secrets and avoid unnecessary full media paths in user-facing output.

The helper does not own editorial decisions, Premiere project mutation, or AI prompts.

### Local HTTP Contract

Version all routes under `/v1`.

Minimum endpoints:

- `GET /health` — helper/version/capability status; no media mutation.
- `POST /v1/media/probe` — validated ffprobe metadata.
- `POST /v1/audio/window` — bounded mono normalized PCM window or a local artifact reference.
- `POST /v1/jobs` — submit a long-running helper operation.
- `GET /v1/jobs/:id` — `queued | running | completed | failed | cancelled`, progress, actionable error, result metadata.
- `POST /v1/jobs/:id/cancel` — idempotent cancellation.
- `DELETE /v1/jobs/:id` — remove helper-owned completed job metadata/artifacts when safe.

Large PCM payloads must not be copied through JSON as unbounded arrays. Small bounded test windows may be JSON for fixtures; production windows use a helper-owned binary/artifact representation with explicit sample rate, channel policy, start sample, length, and content fingerprint.

### Job Safety

- A helper crash cannot mutate a Premiere project.
- Cancellation propagates to child FFmpeg processes.
- Timeouts terminate child processes and return a structured failure.
- Source media is opened read-only. FFmpeg outputs go only to helper-owned temporary/cache locations.
- Failed work never promotes a new valid artifact over the last valid one.
- Concurrent duplicate deterministic work may reuse a valid fingerprinted cache entry.

## FFmpeg Provider

Implement a concrete provider outside `@pea/sync`, under the native-helper/media boundary.

Responsibilities:

1. Use ffprobe to validate media/audio streams and duration.
2. Decode the requested source range to mono PCM with an explicit target sample rate.
3. Record the exact conversion policy as provenance.
4. Enforce maximum decode duration/sample count before allocating output buffers.
5. Surface no-audio, unsupported/corrupt media, timeout, cancellation, and FFmpeg non-zero exit as structured errors.
6. Never let `@pea/sync` spawn FFmpeg directly.

For long recordings, the helper schedules representative windows rather than decoding an entire file into memory. Multi-window/drift correction is a later explicit algorithm; v1 must not claim full-length drift correction from one short window.

## Real-Media Validation

Automated CI continues to use generated tiny fixtures. Real production footage is not committed.

A local acceptance harness supports user-owned or otherwise permitted media and writes only measurements/reports, never the footage.

Validation ladder:

1. **Synthetic signal fixtures** — exact known offsets, silence, periodic ambiguity, gain/DC/polarity, cancellation, corrupt metadata.
2. **Generated container fixtures** — FFmpeg creates tiny video/audio files with known offsets and codec/container variations.
3. **Small permitted real-media fixtures** — camera + recorder/playback samples with manually recorded reference sync points.
4. **Premiere dry-run fixture project** — compare proposed placements against expected project operations.
5. **Premiere disposable-copy apply test** — apply only to a copied test project, then inspect resulting sequence.
6. **Install/relaunch test** — fresh install, helper discovery/start, reconnect, restart, uninstall/cleanup.

Reports record engine/helper versions, media fingerprints, configuration, expected offset, measured offset, error in samples/frames, confidence/review status, and pass/fail. No accuracy percentage is advertised until the real-media set is sufficiently representative and manually verified.

## Premiere Adapter

`adapters/premiere` translates canonical results into explicit Premiere operations.

The adapter exposes two phases:

- **Dry run:** validate project/media IDs, timebases, target sequence, and operation support; return an ordered operation list with warnings/errors.
- **Apply:** execute only a previously validated/approved operation set against the currently identified project state.

If the project/sequence changed after dry-run, Apply must reject stale operations and require a new dry-run.

For Sync v1, the adapter scope is deliberately narrow:

- Resolve Premiere project items to stable canonical media references.
- Create/update a dedicated sync sequence or multicam-oriented placement plan.
- Place clips at canonical offsets with explicit frame quantization policy.
- Add diagnostic markers/metadata where useful.
- Never move/delete source files.
- Never silently overwrite an unrelated existing sequence.

Unsupported Premiere capability must return an explicit unsupported-operation error rather than falling back to a destructive approximation.

## UXP Panel

The first usable panel focuses on Sync rather than exposing unfinished modules.

Minimum flow:

1. Helper status and reconnect/start guidance.
2. Select project items / active selection.
3. Choose Sync mode: Auto, Timecode, Audio, Playback.
4. Run analysis with progress and Cancel.
5. Review results: matched, confidence/evidence, warnings, review-required clips.
6. Dry-run Premiere operations.
7. Explicit **Apply** button.
8. Result summary with retry/review links.

The panel never stores API keys in project files. Session tokens live only for the helper session. Error messages should identify the failed stage without dumping secrets or unnecessary local paths.

## UXP ↔ Helper Connection

Preferred transport: localhost HTTP.

- Host is fixed to `127.0.0.1`.
- Port is ephemeral and discovered through the local launch/bootstrap mechanism.
- Session token is random per helper session.
- Requests carry protocol version and client version.
- The panel handles helper unavailable, incompatible version, timeout, cancellation, and reconnect explicitly.
- WebSocket is not required for v1; progress uses bounded polling. This keeps the protocol simpler and avoids a permanent connection until there is a measured need.

## Packaging

Packaging is local-first and macOS-first for the user's current workflow, while keeping helper code portable where practical.

Artifacts:

- Adobe UXP plugin package containing panel code and Premiere adapter client.
- Native Helper executable/bundle containing the HTTP service and media provider.
- FFmpeg/ffprobe discovery policy. Development may use a system/Homebrew FFmpeg; distributable builds must use a legally compatible, documented bundling strategy or require user-installed FFmpeg. Do not silently download executables at runtime.
- Installer/bootstrap mechanism that installs/locates the UXP plugin and helper, establishes compatible versions, and can remove helper-owned files without touching user media/projects.

Code signing/notarization and Adobe distribution requirements are release gates, not assumptions. Development builds remain local until those requirements are verified against current Adobe/macOS documentation.

## Version Compatibility

UXP client, helper protocol, helper build, Core schema, and Sync API versions are explicit.

- Breaking helper protocol changes increment the protocol major version.
- The UXP panel refuses an incompatible helper major version and explains the required update.
- Artifacts/reports record the versions used to produce them.
- A newer helper may support an older client only when its compatibility table explicitly says so.

## Failure Model

Failures are isolated by boundary:

- FFmpeg/probe failure → helper job failed; no Premiere mutation.
- Sync ambiguity → review-required; no Apply operation generated for that clip unless explicitly resolved.
- Helper disconnect → panel preserves displayed proposal but marks it stale/unavailable for Apply until revalidated.
- Premiere validation failure → dry-run fails; helper artifacts remain reusable.
- Premiere Apply failure → report applied/not-applied operations; never claim an atomic rollback unless the API can actually guarantee it.
- Stale project state → reject Apply and require another dry-run.

## Testing

Required suites:

1. `@pea/sync` contract/algorithm/regression tests from consolidated PRs.
2. Native helper unit tests for authentication, loopback binding configuration, path validation, job lifecycle, cancellation, timeouts, and artifact limits.
3. FFmpeg integration tests using generated tiny media.
4. HTTP contract tests between UXP client and helper.
5. Premiere adapter fixture tests for dry-run and stale-state rejection.
6. Panel state tests for progress, cancel, helper loss, review-required, dry-run, Apply.
7. Manual Premiere acceptance checklist on a disposable project copy.
8. Packaging smoke test for install, launch, helper handshake, relaunch, and uninstall.

CI must run tests/typecheck without requiring Premiere or production media. Premiere/manual packaging acceptance is a separate release gate.

## Delivery Order

This design is intentionally split into independently testable sub-projects:

1. **Sync consolidation** — canonical API + merged regression suite.
2. **Native Helper + FFmpeg provider** — local protocol, jobs, media probe/decode.
3. **Real-media validation harness** — generated fixtures first, permitted real-media report workflow second.
4. **Premiere Adapter** — Sync dry-run/apply translation only.
5. **UXP Sync Panel** — user workflow and helper client.
6. **Packaging & release hardening** — install/relaunch/uninstall, signing/distribution verification.

Each sub-project receives its own implementation plan/branch and must pass its gates before the next layer depends on it.

## Completion Criteria

The first end-to-end milestone is complete only when:

- One canonical Sync API replaces the competing PR implementations.
- Generated real container files are decoded through the Native Helper and synchronized without direct FFmpeg calls in `@pea/sync`.
- A permitted real-media acceptance run records expected vs measured offsets and review outcomes.
- The UXP panel can request Sync, show progress/results, perform a Premiere dry-run, and require explicit Apply.
- A disposable Premiere project copy receives the approved Sync operation without source-media mutation.
- The development package can be installed, relaunched, reconnect to a compatible helper, and uninstalled without deleting user media/projects.
- Whole-workspace CI is green, and manual Premiere/packaging gates are reported separately rather than implied by unit tests.
