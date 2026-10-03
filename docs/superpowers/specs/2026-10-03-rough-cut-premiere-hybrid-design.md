# Premiere Rough Cut Hybrid Design

**Date:** 2026-10-03
**Status:** Approved continuation of the existing Premiere Editing Assistant architecture.

## Goal
Ship a macOS-first reviewable rough-cut flow: selected source media -> PCM analysis -> silence candidates -> explicit user review -> validated SequencePlan -> new Premiere rough sequence. Never mutate source media or silently alter an existing sequence.

## Runtime boundaries
- `@pea/rough-cut`: deterministic NLE-independent candidate/review/SequencePlan logic.
- Native media provider: AVFoundation on macOS when available; existing FFmpeg helper remains a compatible fallback and for CI/generated fixtures.
- Premiere adapter: converts an approved SequencePlan to dry-run operations, rejects stale project state, then creates a new sequence.
- UXP panel: selection, analysis progress/cancel, candidate keep/remove review, dry-run summary and explicit Apply.
- Premiere 26.2+ Hybrid may host the native AVFoundation addon. Premiere 25.6+ retains the authenticated loopback helper path.

## V1 scope
Single selected source clip, 1x speed, constant frame rate, linked source audio/video. Silence detection only. NG semantics, duplicate takes, AI selects and retimed clips remain later features.

## Safety
Unreviewed candidates default to keep. Protected/keep ranges win over removal. Cut boundaries quantize conservatively to the clip frame grid. Apply always creates a newly named rough sequence and never overwrites an unrelated sequence. Project state captured during dry-run must match at Apply.

## Audio analysis
The provider returns bounded interleaved Float32 PCM plus sample rate/channel count/source range/provenance. Silence means every channel remains below threshold for the configured duration. AVFoundation uses AVAssetReaderTrackOutput/AVAssetReader and explicit PCM output settings. Decoder failures never become edit decisions.

## Acceptance
1. Unit tests cover silence, active signal in one channel, opposite-polarity channels, minimum duration, padding, protected ranges, unreviewed candidates, frame quantization and invalid ranges.
2. Generated media validates decoder timing in CI through FFmpeg.
3. macOS acceptance validates AVFoundation against permitted MOV/MP4/WAV samples.
4. Premiere host acceptance: select clip, analyze, review, dry-run, Apply, play resulting sequence and verify A/V sync and cut boundaries.
5. Packaging: CCX installs/relaunches/uninstalls; Hybrid addon is signed/notarized for distribution when enabled.
