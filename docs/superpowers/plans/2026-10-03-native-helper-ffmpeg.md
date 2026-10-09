# Native Helper + FFmpeg Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only Native Helper that securely exposes media probing and bounded FFmpeg audio decoding to the consolidated Sync Engine.

**Architecture:** Add `apps/native-helper` as a Node/TypeScript process that binds only to `127.0.0.1`, authenticates versioned routes with a random session token, and owns ffprobe/FFmpeg child processes. Keep the concrete `AudioSampleProvider` in the helper boundary so `@pea/sync` remains free of process/HTTP/FFmpeg imports. Long operations use an in-memory job registry with cancellation; persistence and auto-update are outside this phase.

**Tech Stack:** Node 22, TypeScript 5.9, pnpm, Vitest, built-in `node:http`, `node:child_process`, `node:crypto`; external `ffmpeg`/`ffprobe` executables discovered from explicit config/PATH.

**Spec:** `docs/superpowers/specs/2026-10-03-premiere-local-pipeline-design.md`

## Global Constraints

- Required cloud services: none.
- Bind only to `127.0.0.1`; never `0.0.0.0`.
- Random session token per helper process; all `/v1/*` routes require it.
- Source media is read-only; helper outputs only to helper-owned temporary/cache paths.
- No silent FFmpeg executable download.
- `@pea/sync` must not import `child_process`, HTTP server code, Premiere, or UXP.
- Audio windows must respect `MAX_ANALYSIS_SAMPLES` before allocation.
- Cancellation/timeouts terminate child FFmpeg/ffprobe processes.
- CI uses fake executables/process adapters and generated fixtures when FFmpeg is available; production footage is never committed.

## Review Focus

1. Helper accidentally binds a LAN/all-interface address: startup must reject anything except `127.0.0.1`.
2. Missing/wrong token reaches media/process code: authentication must reject before handler execution.
3. Malicious/odd file paths become shell injection: process invocation must use argv with `shell:false`, never command concatenation.
4. FFmpeg hangs or caller cancels: child is terminated and job ends `cancelled`/structured timeout failure.
5. Decoder reports more samples than the engine bound: reject/truncate by requested bounded decode policy before allocation, never create an unbounded Float32Array.

---

### Task 1: Helper package, protocol, and loopback authentication

**Files:**
- Create: `apps/native-helper/package.json`
- Create: `apps/native-helper/tsconfig.json`
- Create: `apps/native-helper/src/protocol.ts`
- Create: `apps/native-helper/src/server.ts`
- Create: `apps/native-helper/src/server.test.ts`

**Interfaces:**
- Produces: `createHelperServer({host:'127.0.0.1',port:0,sessionToken?,capabilities?})`, `HelperServer.close()`, `HelperServer.address`, protocol version `1`.

- [ ] Write RED tests for loopback-only host, random token, public `GET /health`, 401 on missing/wrong token, authenticated `/v1/*`.
- [ ] Implement with built-in Node HTTP/crypto only; reject non-loopback host before listen.
- [ ] Run helper tests/typecheck and workspace tests/typecheck.
- [ ] Commit `feat(helper): add loopback authenticated server`.

### Task 2: Safe process runner and ffprobe media probe

**Files:**
- Create: `apps/native-helper/src/process-runner.ts`
- Create: `apps/native-helper/src/ffmpeg.ts`
- Create: `apps/native-helper/src/ffmpeg.test.ts`
- Modify: `apps/native-helper/src/server.ts`

**Interfaces:**
- Produces: `runProcess(executable,args,{signal,timeoutMs,maxStdoutBytes})`; `probeMedia(path, options): Promise<MediaProbe>`.
- HTTP: authenticated `POST /v1/media/probe`.

- [ ] RED tests: argv preserves spaces/metacharacters literally, `shell:false`, timeout/cancel kills child, stdout cap, invalid ffprobe JSON/non-zero exit/no file path become structured errors.
- [ ] Implement ffprobe argv using `-v error -show_format -show_streams -of json -- <path>`.
- [ ] HTTP route validates JSON/body size/path string before invoking probe.
- [ ] Run helper/workspace verification.
- [ ] Commit `feat(helper): add safe ffprobe media probing`.

### Task 3: Bounded FFmpeg PCM provider

**Files:**
- Create: `apps/native-helper/src/audio-provider.ts`
- Create: `apps/native-helper/src/audio-provider.test.ts`
- Modify: `apps/native-helper/src/server.ts`

**Interfaces:**
- Consumes: consolidated `AudioSampleProvider`, `MAX_ANALYSIS_SAMPLES`.
- Produces: `FfmpegAudioSampleProvider implements AudioSampleProvider`.
- HTTP: authenticated `POST /v1/audio/window`.

- [ ] RED tests: no-audio, explicit mono/sample-rate conversion, start sample conversion, sample bound, short output, corrupt/non-finite PCM, cancellation.
- [ ] Decode with argv to raw `f32le`, one channel, explicit sample rate; calculate max duration from requested samples/rate before spawning.
- [ ] Convert Buffer to a bounded copied Float32Array and return exact `startSample`.
- [ ] Route accepts only bounded requests and returns metadata + base64 only for small fixture windows; production job/artifact route remains next task.
- [ ] Run helper/workspace verification.
- [ ] Commit `feat(helper): add bounded FFmpeg audio provider`.

### Task 4: In-memory job lifecycle and cancellation

**Files:**
- Create: `apps/native-helper/src/jobs.ts`
- Create: `apps/native-helper/src/jobs.test.ts`
- Modify: `apps/native-helper/src/server.ts`

**Interfaces:**
- Produces: `JobRegistry.submit(kind, work)`, `get(id)`, `cancel(id)`, `delete(id)`.
- HTTP: `POST /v1/jobs`, `GET /v1/jobs/:id`, `POST /v1/jobs/:id/cancel`, `DELETE /v1/jobs/:id`.

- [ ] RED tests for queued/running/completed/failed/cancelled, idempotent cancel, unknown IDs, delete only terminal jobs, abort propagation.
- [ ] Implement in-memory registry; never claim persistence/recovery after helper restart.
- [ ] Wire only media-probe/audio-window job kinds needed by this phase.
- [ ] Run helper/workspace verification.
- [ ] Commit `feat(helper): add cancellable local jobs`.

### Task 5: Generated-media integration and release gate

**Files:**
- Create: `apps/native-helper/src/ffmpeg.integration.test.ts`
- Create: `apps/native-helper/README.md`
- Modify: root docs report if needed.

**Interfaces:**
- Consumes: system `ffmpeg`/`ffprobe` when present.
- Produces: generated tiny WAV/video fixture acceptance with known offset; skips with an explicit reason when executables are unavailable.

- [ ] Generate tiny deterministic media in test temp directories using FFmpeg; never commit binary fixtures.
- [ ] Probe generated file and decode a bounded PCM window through `FfmpegAudioSampleProvider`.
- [ ] Feed decoded windows to `@pea/sync` and assert known offset within one sample for generated lossless audio.
- [ ] Verify cancellation/timeout with the process adapter independently of system FFmpeg.
- [ ] Run `pnpm --filter @pea/native-helper test && pnpm --filter @pea/native-helper typecheck && pnpm test && pnpm typecheck`.
- [ ] Search `packages/sync` for forbidden imports/FFmpeg invocation.
- [ ] Open a draft PR against `feat/core-contracts`; inspect GitHub CI before claiming completion.
