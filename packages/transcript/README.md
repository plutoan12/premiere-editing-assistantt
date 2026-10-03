# @pea/transcript

Canonical transcript processing for Premiere Editing Assistant.

- Reuses `Transcript` and exact `MediaTime` contracts from `@pea/core`.
- Imports/exports SRT and WebVTT without introducing a second transcript model.
- Tracks immutable transcript revisions and their source.
- Defines a provider boundary for Premiere-native transcript access and local `whisper.cpp` transcription.

## Deliberate boundary

This package does not shell out to FFmpeg or whisper.cpp and does not call Premiere APIs directly. Those belong in adapters/native helpers so the core transcript model remains deterministic and testable.

Next adapters:
1. Premiere UXP transcript adapter, based on Adobe's supported API/sample.
2. Native helper provider for whisper.cpp and FFmpeg audio extraction.
