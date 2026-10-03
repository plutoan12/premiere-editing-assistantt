# Transcript adapter implementation and verification

## Scope and baseline

Continues PR #5 on `feat/transcript-subtitle`, baseline `232e2d5229254c5605c2defd2523946b605ae6e0`. It leaves main, Core, Sync and PR #4 unchanged. Baseline PR CI run 37107841634 was successful. This is an implementation increment, not an installer or release approval.

## Implemented

1. Existing subtitle parser repaired rather than introducing another runtime parser. Strict timestamp grammar, optional WebVTT hours, metadata handling, preserved caption whitespace, bigint-safe export, exact endpoint quantization, source-clock checks and WebVTT ordering.
2. Existing-first orchestration with explicit unavailability, cancellation and bounded host waits. Other errors never silently start a fallback transcription.
3. Adobe adapter: source clip resolution boundary, existing export, opt-in host transcription, runtime capabilities, canonical timing, raw JSON, speaker identity, word confidence and timing.
4. Node provider: explicit local executable/model paths, no-shell subprocesses, FFmpeg conversion, whisper-cli JSON, process cancellation/deadline/log caps, result checks and temporary-file cleanup.

## Verification performed before publishing

- Exact selected-file baseline reconstruction verified against subtitle blob `6de247657cc8fdc6cac5d856c002af064a2a5f4e`.
- Subtitle test-first run: 17 of 18 cases failed; implementation passed all 18.
- Provider test-first run: 7 of 7 failed; implementation passed all 7.
- Adobe adapter test-first run: 11 of 12 failed; implementation passed all 12.
- Native adapter test-first run: 13 of 17 failed; implementation passed all 17.
- Author self-review added three regression cases: rejection with undefined must remain a failure, and WebVTT parse/export must reject descending starts. All three failed before fixes.
- Final local run: **57 passed, 0 failed, 0 skipped**, including actual `/usr/bin/ffmpeg` conversion of a generated WAV. The whisper result was supplied by an explicitly fake executable, not a speech model.
- Local DNS blocks repository clone and dependency installation. Local tests execute the same Node assert bodies after TypeScript transpilation, replacing only Vitest describe/it registration with node:test. This is NOT a whole-workspace dependency or TypeScript check. The existing GitHub Actions workflow is the full-workspace test/typecheck gate; see the latest PR status for its outcome.
- The optional real-FFmpeg test is skipped in CI unless PEA_TEST_FFMPEG is configured. No claim of real model inference or Premiere execution follows from a green CI.

## Review decisions and boundaries

Review was author self-review, not an independent reviewer. Process/host separation avoids Node imports in UXP and avoids changes to concurrent Sync work. Its cost is that the panel-helper transport is still a separate task. Source floating-point seconds are rounded to microseconds; unchanged raw JSON remains necessary for lossless source retention. Existing revision snapshots are detached, not persistent or deeply frozen.

No main/base merge, media upload, paid API call, binary/model download, cloud deployment, or source-media modification occurred. Transcript import/apply transactions, timeline projection, UI wiring, authenticated helper transport, storage, package/signing, real model inference, Apple Silicon behavior, long-file windowing/disk reservation and production-footage acceptance remain open.

## Reuse and provenance

- Existing Core contracts and transcript package are reused. No new runtime subtitle-parser dependency or copied vendor source was added. `srt-vtt-parser`, WhisperX and pyannote remain candidates, not installed dependencies.
- Adobe API reference: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/transcript/ (export since 25.6, hasTranscript since 26.3; additional methods guarded at runtime).
- Adobe sample reference: https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/main/sample-panels/premiere-api/src/transcript.ts ; reviewed blob `74fd8e11d2b521dac0f24dbe0af8f19f2881de84`.
- Adobe JSON schema: same repository, `sample-panels/premiere-api/assets/transcript_format_spec.json`, blob `1fb5dca88bc20d1b19be74d327b61de6274af45a`. Repository LICENSE identifies Apache-2.0 (blob `837d1b4fc6fe23908541a0923c4e65b7ebe13f33`). Integration code is independently written against the API/format, not vendored sample code.
- whisper.cpp CLI reference: https://github.com/ggml-org/whisper.cpp/tree/v1.9.4 ; `examples/cli/cli.cpp` blob `c64976a56375331c2446b3ba946757b3f6fabec8`, CLI README blob `65285c3cb66d530ee3c6240a31883c58501d4116`. Repository LICENSE is MIT, blob `e7dca554bcb802f98408383a864404e3aa4eacca`.
- WebVTT grammar reference: https://www.w3.org/TR/webvtt1/ . Integration implements documented text/timing scope, not all rendering features.
- FFmpeg and models are externally supplied, not distributed here. The selected binary build, model provenance/license, checksum and distribution terms must be checked before packaging. Code-license labels do not establish a model-weight license.
