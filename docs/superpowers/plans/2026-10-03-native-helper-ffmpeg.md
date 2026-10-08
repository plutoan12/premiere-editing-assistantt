# Native Helper + FFmpeg Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect user-owned media files to the canonical `@pea/sync` engine through a loopback-only native helper that owns ffprobe/FFmpeg processes, bounded PCM windows, jobs, cancellation, and cache artifacts.

**Architecture:** Add a Node 22 local helper under `apps/native-helper` and an HTTP-backed `AudioSampleProvider` client outside `@pea/sync`. The helper binds only to `127.0.0.1`, uses an ephemeral port and per-session bearer token, probes media before decoding, writes only helper-owned temp/cache files, and terminates FFmpeg children on cancel/timeout. `@pea/sync` remains free of HTTP and process imports.

**Tech Stack:** TypeScript 5.9, Node 22 built-ins, pnpm, Vitest, FFmpeg/ffprobe CLI, `@pea/core`, `@pea/sync`.

**Spec:** `docs/superpowers/specs/2026-10-03-premiere-local-pipeline-design.md`

## Global Constraints
- Required cloud services: none.
- Bind only to `127.0.0.1`; never `0.0.0.0`.
- Every `/v1/*` request requires a cryptographically random session token.
- Source media is read-only; output goes only to helper-owned temp/cache paths.
- `@pea/sync` never imports FFmpeg, HTTP server, Premiere, or UXP APIs.
- Production PCM is bounded and binary/artifact-backed; no unbounded JSON sample arrays.
- Cancellation and timeout terminate owned child processes.
- Development may discover system/Homebrew FFmpeg; do not silently download executables.

## Review Focus
1. Paths containing spaces, Unicode, quotes, and leading dashes must be passed as argv values, never shell-concatenated.
2. A client disconnect/cancel while FFmpeg is running must terminate the child and leave no promoted artifact.
3. A media file with video but no audio must return a structured no-audio error, not an empty successful window.
4. A malicious/missing bearer token must never reach media/process code.
5. Oversized requested windows must be rejected before allocating output buffers.

---

### Task 1: Helper protocol, authentication, and loopback server

**Files:**
- Create: `apps/native-helper/package.json`
- Create: `apps/native-helper/tsconfig.json`
- Create: `apps/native-helper/src/protocol.ts`
- Create: `apps/native-helper/src/server.ts`
- Create: `apps/native-helper/src/server.test.ts`

**Interfaces:**
- Produces: `createHelperServer(options): Promise<HelperServer>`, `HelperServer { host, port, token, close() }`; `GET /health`; authenticated `/v1/*`.

- [ ] Write tests proving host is exactly `127.0.0.1`, port is ephemeral, tokens differ per server, `/health` works without auth, and `/v1/media/probe` returns 401 before route logic without the token.
- [ ] Run `pnpm --filter @pea/native-helper test -- server.test.ts`; expected RED because the package/server do not exist.
- [ ] Implement the minimal Node HTTP server and constant-time token comparison. Limit request body size before JSON parsing.
- [ ] Run targeted test, package test, and typecheck; expected PASS.
- [ ] Commit: `feat(helper): add authenticated loopback protocol`.

### Task 2: Safe ffprobe discovery and media probing

**Files:**
- Create: `apps/native-helper/src/process-runner.ts`
- Create: `apps/native-helper/src/ffmpeg.ts`
- Create: `apps/native-helper/src/ffmpeg.test.ts`
- Modify: `apps/native-helper/src/server.ts`

**Interfaces:**
- Produces: `discoverFfmpeg(env): FfmpegTools`; `probeMedia(path, ctx): Promise<MediaProbe>`; structured `HelperError` codes `FFMPEG_NOT_FOUND | MEDIA_NOT_FOUND | NO_AUDIO | CORRUPT_MEDIA | TIMEOUT | CANCELLED | PROCESS_FAILED`.

- [ ] Write RED tests using fake executable scripts for argv preservation, Unicode/space paths, non-zero exit, timeout, abort, and video-without-audio probe JSON.
- [ ] Run targeted tests; expected RED.
- [ ] Implement `spawn` with `shell:false`, bounded stdout/stderr capture, explicit executable discovery, and child termination on timeout/AbortSignal.
- [ ] Implement `POST /v1/media/probe` and normalize ffprobe JSON without exposing unnecessary full paths.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(helper): probe media through bounded ffprobe`.

### Task 3: Bounded PCM window extraction

**Files:**
- Create: `apps/native-helper/src/audio-window.ts`
- Create: `apps/native-helper/src/audio-window.test.ts`
- Modify: `apps/native-helper/src/server.ts`

**Interfaces:**
- Produces: `decodeAudioWindow(request, ctx): Promise<AudioArtifact>`; artifact metadata includes `sampleRate`, `startSample`, `sampleCount`, `channelPolicy: "mono-average"`, SHA-256 content fingerprint, and helper-owned binary path.

- [ ] Write RED tests for max duration/sample enforcement before spawn, explicit mono/sample-rate argv, cancellation cleanup, no-audio rejection, and successful float32le artifact metadata.
- [ ] Run targeted tests; expected RED.
- [ ] Implement bounded `ffmpeg -vn -ac 1 -ar <rate> -f f32le` extraction to helper temp/cache, never source paths.
- [ ] Add `POST /v1/audio/window`; small fixture mode may return bounded base64, production returns artifact metadata.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(helper): decode bounded pcm windows`.

### Task 4: Job lifecycle and cancellation

**Files:**
- Create: `apps/native-helper/src/jobs.ts`
- Create: `apps/native-helper/src/jobs.test.ts`
- Modify: `apps/native-helper/src/server.ts`

**Interfaces:**
- Produces: `POST /v1/jobs`, `GET /v1/jobs/:id`, `POST /v1/jobs/:id/cancel`, `DELETE /v1/jobs/:id`; states `queued | running | completed | failed | cancelled`.

- [ ] Write RED tests for valid transitions, idempotent cancel, cancel killing owned child work, failed jobs not promoting artifacts, and safe deletion only of helper-owned completed metadata/artifacts.
- [ ] Run targeted tests; expected RED.
- [ ] Implement in-memory v1 job registry with AbortController ownership and explicit artifact cleanup.
- [ ] Run package suite + typecheck; expected PASS.
- [ ] Commit: `feat(helper): add cancellable local jobs`.

### Task 5: HTTP AudioSampleProvider client and generated-container integration

**Files:**
- Create: `packages/sync-helper-client/package.json`
- Create: `packages/sync-helper-client/tsconfig.json`
- Create: `packages/sync-helper-client/src/index.ts`
- Create: `packages/sync-helper-client/src/index.test.ts`
- Create: `tests/ffmpeg/generated-sync.integration.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: helper `/v1/media/probe`, `/v1/audio/window`; canonical `AudioSampleProvider`.
- Produces: `createHelperAudioProvider(config): AudioSampleProvider`.

- [ ] Write RED contract tests for token/version headers, binary float32 decoding, metadata validation, helper error mapping, and cancellation.
- [ ] Run targeted tests; expected RED.
- [ ] Implement the client without adding HTTP/process imports to `@pea/sync`.
- [ ] Add CI integration test that generates two tiny permitted fixtures with FFmpeg at a known offset, starts helper, decodes both through HTTP, runs `syncClips`, and asserts offset error <= 1 sample.
- [ ] Update CI to install/use Ubuntu FFmpeg and run integration tests; do not require Premiere.
- [ ] Run `pnpm test && pnpm typecheck`; expected PASS.
- [ ] Commit: `test(sync): verify ffmpeg helper end to end`.

### Task 6: Verification and documentation

**Files:**
- Create: `apps/native-helper/README.md`
- Modify: `packages/sync/README.md`

- [ ] Verify no forbidden imports/process calls under `packages/sync`.
- [ ] Run full workspace tests/typecheck and generated-container integration.
- [ ] Document development FFmpeg discovery, loopback/token model, cancellation, cache ownership, and limitations: one-window v1 does not claim drift correction.
- [ ] Commit: `docs(helper): document local ffmpeg boundary`.
