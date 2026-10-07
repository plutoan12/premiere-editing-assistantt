# Subtitle — Premiere host validation

Date: 2026-10-08 (Asia/Seoul)

## Verified implementation and package

Source commit: `f9c659ade2e10920be6bce6f8266cb16e142fb62` on `codex/subtitle-review-workflow`, continuing PR #16 against the unmerged helper-transport branch. Source-dialogue review and rendered-sequence caption review retain equal support. Timeline application requires a reviewed sequence document with an explicit start offset.

The caption companion reuses [Adobe's caption creation example](https://github.com/Adobe-CEP/Samples/blob/e4946b73ac1e566dced8e95dba10811c31036927/PProPanel/jsx/PPRO/Premiere.jsx#L2923-L2980), official CSInterface, and JSON2. The installed public UXP API exposes caption-track queries but no creation method; the companion calls the official ExtendScript `sequence.createCaptionTrack(importedSRT, 0)`. The SRT already contains the sequence offset. The bridge pins the saved project path and sequence ID, identifies the newly imported item by node ID and media path, and preserves existing tracks. Host acceptance of the request is reported separately from visual validation.

The UI persists attempted applications using document identity, target identity and a SHA256 of the final SRT. Including SRT content fixes a reproduced collision where two edits branching from the same saved revision had different text but the same revision ID. Unknown outcomes are never retried automatically. Known dispatched failures also remain recorded; the first release intentionally has no retry/reset control.

- Workspace tests: **382 passed**, one opt-in real-model test skipped in the general suite. Actual Korean and English model runs were performed separately; see the [model evidence](2026-10-08-subtitle-real-model.md).
- Signing-boundary tests: **4 passed**. All 13 workspace package typechecks and both panel builds passed.
- [GitHub package/signing run](https://github.com/plutoan12/premiere-editing-assistantt/actions/runs/37656996729): succeeded on standard `macos-15-intel` using the pinned official Adobe ZXPSignCmd 4.1.3. Both the ZXP and its extracted directory passed full SDK verification.
- [GitHub CI run](https://github.com/plutoan12/premiere-editing-assistantt/actions/runs/37656996759): succeeded.
- The package job tests PR merge commit `77535f5498d0d5380a71269a9d0764ea14239c76`, whose parents are the dependency base and source commit above. All 11 signed payload files were matched to the local build.
- Signed ZXP SHA256: `410f58dc19f4c102d585ac2c6539c549f10892f14d7fc89eefe3cc93f6064bc5`.
- Local package/evidence: `dist/caption-signed/pea-caption-bridge.zxp`, `pea-caption-bridge-verification.txt`, and `local-download-verification.json` in the same directory. The CI certificate is self-signed; its private key is discarded. No OS trust-root installation or unsigned-extension bypass was used.

## Actual installation and test project

Adobe UnifiedPluginInstallerAgent **8.5.0.13** returned `Installation Successful` and exit code 0. Installed location: `/Library/Application Support/Adobe/CEP/extensions/Subtitle Caption Bridge`. Every installed file, including the signature, matches the signed ZXP. Receipt: `build/host-validation-2026-10-08/installed-package.json`.

In Premiere Pro **26.5.2.5**, a separate project was created and saved at `build/host-validation-2026-10-08/Subtitle-Host-Validation-20261008.prproj`. A 1280×720, 25 fps MOV containing the actual-model Korean synthetic speech was imported, and Premiere created the `ko-yuna-premiere` sequence from it. Its displayed duration is `00:00:10:23`. The saved pre-caption project has no caption objects; its decompressed snapshot is `build/host-validation-2026-10-08/before-project.xml`.

The test media is `build/host-validation-2026-10-08/ko-yuna-premiere.mov`. The actual model's unchanged sequence document is `build/deps/subtitle/fixtures/ko-yuna-actual.sequence.subtitle.json`; it has two cues at 0–4.560 seconds and 4.560–10.760 seconds.

An initial file-picker operation selected the dependency directory instead of one video. It was undone in this new test project; the intended video was then imported alone. No caption application is inferred from that import.

## Pending actual caption acceptance

The newly installed extension was not yet listed in Premiere's open session. A restart was attempted, but Premiere prompted to save another task's `RoughCut-Host-Validation-20261008.prproj`. The restart was canceled to preserve that task's unsaved state, and the user was asked how to handle the open test projects. No unsigned-extension setting was enabled.

Caption panel loading, the native `createCaptionTrack` call, visible cue text/times, playback, and persistence after reopening are **not yet verified**. The Subtitle UXP review panel's real host load also remains unverified. Installation and automated tests do not establish either result.

After the restart is available, open **Window → Extensions → Subtitle · 캡션 적용**, choose the actual-model sequence JSON, verify the displayed test project and `ko-yuna-premiere` sequence, and apply once. Check the new caption track and both cue times, save and reopen the test project, and verify no duplicate track can be created by reopening the same document. Record the result here before calling the host acceptance complete.
