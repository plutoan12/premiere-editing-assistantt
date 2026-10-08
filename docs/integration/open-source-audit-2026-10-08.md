# Open-source integration audit (2026-10-08)

## Goal
Reuse verified existing code before adding dependencies. This branch is an audit and integration staging area, not an installation or release.

## Candidate sources (inspect licenses and exact versions before adoption)
- AdobeDocs/uxp-premiere-pro-samples: Premiere host panel patterns; compare against actual Premiere 26.5.2 APIs.
- ggml-org/whisper.cpp: local transcription; reuse existing adapter, do not duplicate.
- FFmpeg/FFmpeg: media probing, audio analysis, loudnorm and rendering; verify LGPL/GPL build configuration and redistribution obligations.
- MiniSearch: already used in PR #17; preserve MIT notice and version pin.

## Existing branches to reconcile
- PR #1 core contracts is the integration base, not merged into main.
- PR #12 Sync panel, PR #16 Subtitle review/caption bridge, PR #17 Organizer, PR #13 Audio, PR #15 Graphics.
- PR #14 Rough Cut was merged into its feature base; verify ancestry before cherry-picking.

## Release blockers
1. Build a dependency/PR ancestry matrix and choose one canonical helper and panel integration path.
2. Run clean install, license scan, lockfile integrity, tests, typecheck and builds in isolated environment.
3. Validate actual Premiere 26.5.2 loading, source selection, sequence apply, playback, Undo, save/reopen on approved footage.
4. Graphics MOGRT text write currently blocked by unsupported encoding: do not enable production writes.
5. Sign/package installers only after verified host compatibility.

## Safety
No bulk installation, blind merging, source-media mutation or release from this audit. Every new dependency needs pinned version, source license, vulnerability check, test and rollback plan.
