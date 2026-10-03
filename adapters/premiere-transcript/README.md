# @pea/premiere-transcript

UXP-safe adapter for source clip transcripts. It has no Node process, filesystem, network, or paid API dependency.

`createPremiereTranscriptAdapter({ api, resolveClip, allowTranscription?, hostTimeoutMs? })` accepts the real `ppro.Transcript` and an async resolver from a Core media asset ID to a pinned `ClipProjectItem`. Do not resolve by whatever happens to be selected after an asynchronous wait. `readSnapshot(input)` returns the canonical transcript, speaker labels, per-word timing/confidence, and unchanged `rawJSON`. `transcribe(input)` returns only the canonical transcript and satisfies `TranscriptProvider`.

Existing transcripts are exported first. Missing `hasTranscript` is supported by using `exportToJSON`; the former is newer than the latter. New host transcription requires explicit `allowTranscription: true` and runtime method availability. Sequences, corrupt data, host failures, and unresolved speakers are not silently treated as absence.

Adobe floating-point seconds are rounded to microseconds for Core. Raw JSON is retained unchanged; display text spacing is reconstructed from word type and language, not a lossless text serialization. Persist raw JSON and word metadata alongside revisions when implementing storage. No word timing is invented from corrected segment text.

Cancellation and timeout stop awaiting the host and prevent later steps. Adobe work already queued inside Premiere may continue because this API boundary does not expose a cancellation operation.

Not implemented here: selection/panel wiring, sequence-time projection, transcript import/apply transactions, storage, installation, and real Premiere acceptance. A mock host test is not a Premiere end-to-end test.
