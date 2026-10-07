# @pea/transcript

Shared canonical transcript processing, reusing Transcript/TranscriptSegment/MediaTime from @pea/core.

- SRT and WebVTT text/timing interchange with strict timestamps, nonnegative source time, bigint arithmetic, and one-time absolute endpoint quantization.
- WebVTT accepts optional hours and skips NOTE/STYLE/REGION metadata. Styles, cue settings and identifiers are not preserved. Streaming timestamp maps require explicit mapping and are rejected.
- Export one source asset or an explicitly projected timeline. Mixed source clocks and sub-millisecond collapsed cues are rejected, not silently emitted.
- `transcribePreferExisting(input, existing, fallback?)` returns `{ transcript, source }`. Only TranscriptUnavailableError permits fallback. Malformed results, host failures and cancellation do not trigger another transcription.
- `observeTranscriptTask` bounds waits and removes listeners; it cannot cancel an uncooperative external host itself.
- `createRevision` retains a detached snapshot via structuredClone. It is not a persistence layer or a deeply frozen data structure.

## Subtitle documents

`createSubtitleDocument({ id, origin, transcript, source, createdAt?, rawSourceJSON? })`
creates a versioned document with a detached master transcript. `origin` records
`kind` (`source` or `sequence`), `mediaAssetId`, `label`, and `inputRevision`.
Sequence documents additionally require an explicit, nonnegative `timelineStart`.
All transcript times remain relative to the supplied input: only sequence export
adds `timelineStart`. Source export retains the raw source clock.

- `currentTranscript(document)` and `searchSubtitleDocument(document, query)` return
  detached results from the latest revision. Search matches corrected text with
  Unicode NFC normalization; an empty query returns no results.
- `updateSubtitleCue(document, { segmentId, text?, range?, speakerId? })` edits text,
  explicit timing or speaker; `speakerId: null` clears the speaker.
- `splitSubtitleCue(document, { segmentId, splitAt, leftText, rightText })` requires
  an explicit absolute input-time boundary strictly inside the cue and both texts.
  It never estimates where a word was spoken.
- `mergeSubtitleCues(document, { firstSegmentId, secondSegmentId })` accepts only
  adjacent cues in their current order with matching assets and speakers. It
  rejects overlapping or reversed times, includes any intervening gap in the
  duration, and joins texts with one newline.
- Edits return a new document and append a detached revision. The master, prior
  revisions and `rawSourceJSON` remain preserved. Revision `source` retains the
  original provider/format. The current revision must be the end of a linear
  parent chain; branching and undo are outside this document API.
- `serializeSubtitleDocument` / `parseSubtitleDocument` persist schema `1.0` with
  exact decimal strings for bigint ticks. Only known MediaTime fields are revived;
  raw provider JSON is retained as a verbatim string. Other schema versions are
  rejected until an explicit migration exists. These functions return strings or
  objects and do not read or overwrite files.
- `exportSubtitleDocument(document, "srt" | "vtt")` reuses the existing interchange
  exporters. Sequence offsets are added as exact rational times before the single
  millisecond quantization. Output does not include revision history or provider
  metadata; save the document JSON to retain those.

Every entry point validates the document, including its revision history. Duplicate
revision/cue IDs, broken parent chains, mismatched origin assets, negative times,
nonpositive durations and unsafe timebases are rejected. Cue text must be nonempty
and contain neither blank lines nor `-->` timing delimiters, so it cannot introduce
extra SRT/WebVTT blocks. Regular multiline text and user whitespace are preserved.
Failed edits leave the supplied document untouched. Returned objects are detached,
not frozen; saving or exporting validates them again.

Host and process execution live in `adapters/premiere-transcript` and `adapters/whisper-cpp`. The panel must use a helper transport for Node work. This package is not an installable Premiere plugin.
