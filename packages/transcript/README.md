# @pea/transcript

Shared canonical transcript processing, reusing Transcript/TranscriptSegment/MediaTime from @pea/core.

- SRT and WebVTT text/timing interchange with strict timestamps, nonnegative source time, bigint arithmetic, and one-time absolute endpoint quantization.
- WebVTT accepts optional hours and skips NOTE/STYLE/REGION metadata. Styles, cue settings and identifiers are not preserved. Streaming timestamp maps require explicit mapping and are rejected.
- Export one source asset or an explicitly projected timeline. Mixed source clocks and sub-millisecond collapsed cues are rejected, not silently emitted.
- `transcribePreferExisting(input, existing, fallback?)` returns `{ transcript, source }`. Only TranscriptUnavailableError permits fallback. Malformed results, host failures and cancellation do not trigger another transcription.
- `observeTranscriptTask` bounds waits and removes listeners; it cannot cancel an uncooperative external host itself.
- `createRevision` retains a detached snapshot via structuredClone. It is not a persistence layer or a deeply frozen data structure.

Host and process execution live in `adapters/premiere-transcript` and `adapters/whisper-cpp`. The panel must use a helper transport for Node work. This package is not an installable Premiere plugin.
