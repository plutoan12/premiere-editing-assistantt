# Subtitle review workflow — implementation evidence

Date: 2026-10-07

## What is implemented

The standalone Subtitle developer panel treats source dialogue and rendered-sequence captions as equal document types. Both support library search, explicit timing/text/speaker correction, split/merge, revision history, JSON save/open, and SRT/VTT export. A rendered sequence requires an explicit start offset; the offset is applied once at export and does not alter the imported master or source clock.

The panel can read the selected Premiere source clip's existing transcript, request host transcription with a separate button, or submit a picked local media file to an already configured HTTPS helper. The helper processes the entire file's first audio stream. There is no model download or media upload path in this increment.

## GitHub code reused

Implementation starts from [helper transport integration `9c1c9c0`](https://github.com/plutoan12/premiere-editing-assistantt/commit/9c1c9c0143a6afb7b9f283c981faf7ae80091d34), on `feat/helper-transport-packaging`. This is an unmerged dependency branch, not `main`.

| Existing code | Reuse in this change |
| --- | --- |
| `packages/core` | Transcript schema, exact bigint time, schema-based detached copies |
| `packages/transcript` | Existing SRT/VTT parser/exporter, revision constructor, provider cancellation and timeout helpers |
| `adapters/premiere-transcript` | Actual Adobe JSON parser and runtime capability checks; raw JSON retained in documents |
| `packages/helper-protocol` | Authenticated loopback client and version contract |
| `adapters/whisper-cpp` + `apps/native-helper` | Existing shell-free native transcription path and job server; no replacement speech engine |
| `scripts/build-rough-panel.mjs` | Existing esbuild staging pattern adapted for a separate Subtitle panel |

The existing transcription adapter uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp); the host adapter follows [Adobe's Premiere UXP samples](https://github.com/AdobeDocs/uxp-premiere-pro-samples). This change does not vendor their source or distribute model/native binaries. Additional subtitle parsers were considered in the earlier research; the repository's existing tested parser already covers this increment, so no redundant parser dependency was added.

## Verification boundaries

- New document, session, helper, and host-selection behavior was tested through failing regressions followed by implementation. A later regression removes the `structuredClone` global dependency from transcript revision/edit paths.
- A real loopback HTTP integration test exercises the existing helper server and client, exact bigint serialization, editing, JSON reopening, and sequence-offset SRT output. Speech recognition in this test is an explicit fixture.
- Independent review found and fixed a stale-source bug: media relinking inside the same Premiere project now invalidates the pending transcript result. Availability, transcription, and export relinking regressions cover it.
- Independent review also reproduced an older file write overwriting a newer correction after hide/show. Non-cancellable file writes now retain the UI lock through completion; a deferred-write regression verifies both the lock and subsequent saved content.
- Final results: transcript 87/87 and panel 67/67 tests pass. Across all packages: 310 passed, 2 pre-existing FFmpeg-dependent failures, 2 native/model checks skipped. All 12 package typechecks, staged bundle generation, bundle syntax and diff checks pass.
- The panel is a staged development plugin, not a signed CCX release. Actual Premiere loading/file dialogs and real-model transcription remain unverified. A live-host attempt was stopped because another active task was concurrently operating the same UXP Developer Tools / Premiere instance. No Subtitle panel load was confirmed and no project edits were made by this task.
- Before these changes, full workspace tests failed in `rough-media` on two cases requiring `/usr/bin/ffmpeg` (`ENOENT`). That dependency is absent in the current environment. It is not a Subtitle regression. The full no-bail run still executes the remaining packages.
- Actual-model tests remain skipped without supplied executable/model/media paths. Synthetic/transport tests establish no speech-recognition accuracy result.

## Remaining host acceptance

1. Build `@pea/subtitle-panel` and load `dist/premiere-subtitle/manifest.json` using UXP Developer Tools while that application is not being operated by another task.
2. Import `apps/subtitle-panel/fixtures/review-sample.srt` as source; search `편집본`, change a cue, split and merge it, save JSON and SRT. Reload and reopen JSON; verify master and current revision separately.
3. Import the same sample as sequence with start `10.5`; first exported cue must start at `00:00:11,500`. Re-exporting must not add the offset twice.
4. On an authorized test clip, check existing-transcript read, missing-transcript feedback, and separate explicit host transcription. Switch project or relink during the operation; it must refuse the stale result.
5. With approved local binaries/model and a working trusted HTTPS helper, verify file transcription, cancellation, and Korean transcript/timing quality against a reference.

Automatic sequence audio rendering, timeline caption-track insertion, source-monitor seeking, word alignment, translation, and Graphics/MOGRT styling are outside this increment.
