# Native Helper + FFmpeg Provider Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Execute each task with a failing test followed by implementation and verification.

**Goal:** Decode permitted local media through a token-authenticated loopback helper and feed the consolidated `@pea/sync` API.
**Architecture:** New `packages/native-helper` owns process, media, HTTP, and job boundaries; Sync remains unchanged. Fixed typed routes, bounded binary PCM, a private session file, and explicit approved media roots. Standalone development bundles are not signed macOS installers or UXP packages.
**Tech Stack:** Node 22, TypeScript, built-in Node APIs, Vitest, esbuild, system-installed FFmpeg/ffprobe.
**Spec:** `docs/superpowers/specs/2026-10-03-premiere-local-pipeline-design.md` (approved; Core base 131f050).

## Global Constraints
- No required cloud service, paid model, external download, or source-media mutation.
- Loopback 127.0.0.1, ephemeral port, 32 random token bytes; token never returned by HTTP health or printed to logs.
- Deny unapproved Host/Origin; token on all /v1 routes; 64 KiB JSON limit.
- POSIX development host initially: macOS/Linux; no Windows support claim.
- Read-only inherited file descriptor for FFmpeg; fixed demuxer and protocol allowlists; no arbitrary shell commands, URLs, filters, or executable paths over HTTP.
- PCM: Float32 mono, at most 262144 samples; selected source channel, explicit resample rate; no unbounded JSON arrays.
- Queue max 32 retained jobs, one active Sync job, max 16 clips; cancellation kills media child processes; no automatic conversion of review into matched.
- Single explicit analysis window per clip. No automatic long-recording search, drift correction, or actual production-footage claim.

## Review Focus
- Cancellation races, stubborn subprocesses, and late failures must release children/listeners without promoting cancelled results (Tasks 1, 4).
- Symlink/path escapes, playlists, network protocols, renamed/replaced media, and non-regular files must not become arbitrary local-file access (Tasks 2, 5).
- Nonzero audio/video start offset must not be silently confused with sample-order origin (Task 2).
- Probe/decode body sizes, concurrent reads, and retained jobs must stay bounded (Tasks 1, 4, 5).
- Session tokens must not leak through health, job results, errors, or CLI logging (Tasks 5, 6).

## Task 1: Bounded subprocess runner
Files: `src/errors.ts`, `src/process.ts`, `src/process.test.ts`.
Interface: `runProcess(executable, args, {signal, timeoutMs, maxOutputBytes, inputFd?}): Promise<Buffer>`.
- [ ] Write/run tests for real child success, failure, missing command, pre-abort, active abort, SIGTERM resistance, timeout, output overflow, and shell metacharacters as inert arguments.
- [ ] Implement spawn with shell:false, bounded stdout/stderr, SIGTERM then SIGKILL, settle after close.
- [ ] Run focused tests and commit.

## Task 2: Local media boundary
Files: `src/media.ts`, `src/paths.ts`, `src/paths.test.ts`, `src/media.integration.test.ts`.
Interface: `MediaService.create({roots, ffmpeg, ffprobe})`, `register(path)`, `read(assetId, window, signal)`; returns metadata or `{window, sha256, policy}`.
- [ ] RED: path/URL/escape/symlink/directory rejection, generated WAV/MOV probe, exact window length/origin, selected channel, resample, no audio, corrupt media, changed files, out-of-range windows, incompatible timestamps.
- [ ] Implement root validation, descriptor ownership, normalized ffprobe metadata, bounded ffmpeg f32le pipe, revision checks; never expose raw stderr.
- [ ] GREEN and commit. Fixture files are temporary and never committed.

## Task 3: Consolidated Sync provider
Files: `src/sync-job.ts`, `src/sync-job.integration.test.ts`.
Interface: `executeSync(id, parsedRequest, media, signal, progress): Promise<{group, inputs}>`.
- [ ] RED: generated audio containers with known signed offset, repeated signal review, corrupt target partial success, exact decimal-string bigint transport.
- [ ] Feed real decoded windows to `syncClips`; register mapping privately; no direct decoder imports in Sync.
- [ ] GREEN and commit.

## Task 4: Bounded cancellable queue
Files: `src/jobs.ts`, `src/jobs.test.ts`.
Interface: `JobQueue.submit(work)`, `get(id)`, `cancel(id)`, `remove(id)`, `close()`.
- [ ] RED: queued/running/completed/failed/cancelled, late success ignored, active delete rejected, capacity eviction, cancellation never runs queued work, shutdown cancellation.
- [ ] Implement one active worker with immutable public snapshots and terminal-result eviction; no input file paths or tokens in public records.
- [ ] GREEN and commit.

## Task 5: Authenticated HTTP API
Files: `src/server.ts`, `src/server.test.ts`, `src/protocol.ts`.
Interface: `startHelper({media, allowedOrigins?}) => {url, token, close()}`.
Routes: GET /health; POST /v1/media/probe; POST /v1/audio/window (f32le); POST /v1/jobs (audio-sync); GET /v1/jobs/:id; POST /v1/jobs/:id/cancel; DELETE /v1/jobs/:id.
- [ ] RED: random tokens, Host/Origin/token validation, 64KiB JSON/strict schema, binary header/sha metadata, job lifecycle, client-disconnect cleanup, errors do not echo secrets/paths.
- [ ] Implement fixed route surface with deny-by-default origin policy and socket/request cleanup.
- [ ] GREEN and commit.

## Task 6: Development launcher, build, CI, documentation
Files: `src/cli.ts`, `src/session.ts`, `src/session.test.ts`, `package.json`, `tsconfig.json`, `build.mjs`, README; `.github/workflows/native-helper.yml`.
- [ ] RED: private session-directory/file modes, no overwrite, token not logged, cleanup on shutdown; CLI requires approved roots.
- [ ] Build CLI/library bundles. No FFmpeg bundling/downloading or signing; require user-installed binaries.
- [ ] Run focused + whole-repository tests/typecheck in GitHub CI; generated-media integration and bundled CLI smoke test on Ubuntu and macOS.
- [ ] Separate author review; regressions for findings. Create PR against `feat/core-contracts`; do not merge or close others.

## Verification environment
Local container cannot resolve GitHub/npm. Local test registration may use Node's describe/it in place of Vitest only; keep identical assertion bodies and separately report this limitation. Full installed workspace Vitest/typecheck/build must be verified via GitHub Actions. Never infer a passing command from source inspection.
