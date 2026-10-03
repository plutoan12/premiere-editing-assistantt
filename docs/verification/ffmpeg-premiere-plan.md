# FFmpeg and Premiere sync integration, 2026-10-03

Continuation explicitly requested after Sync PR #2. Base: 49c96f9.
Scope: real local file decoding, bounded-window sync, review report, additive FCP7 XML export, developer-loadable UXP import panel. No source writes, automatic merges, paid services or real-footage publication.

1. RED/GREEN: subprocess limits/cancellation, local-file validation, ffprobe and exact sample windows. Decode selected channel explicitly, retain stream timestamp origin, no implicit clock/jam assumptions.
2. RED/GREEN: frame-safe Premiere plan and xmeml export. Reject review/partial results and incompatible rates; require explicit nearest-frame policy for fractional offsets. Preserve original audio channels and link camera video/audio. New sequence only.
3. RED/GREEN: manifest-driven local CLI producing report and XML with exclusive output creation. Integrate actual FFmpeg-generated WAV/MOV fixtures and verify source hashes.
4. RED/GREEN: UXP import guard, active project check and explicit approval; report actual host success only from importFiles result. Developer loading is not a signed release.
5. Full remote pnpm test/typecheck and FFmpeg integration CI; author self-review. No real production footage is attached, and no Premiere host is connected: both acceptance gates remain pending.

Rulings: use per-file explicit bounded analysis windows rather than pretend to search arbitrary recording lengths; cost is manual window selection for nonoverlapping starts. Use FCP7 xmeml, not FCPX fcpxml; cost is frame-quantized placement and host round-trip testing. No frame-rate/VFR conversion. Execute in this session without repeated approval requests; do not merge.

## Execution record

- Baseline: 43 existing sync assertions passed locally.
- FFmpeg provider: missing-behavior RED, then 12/12 GREEN; additional AAC/44.1kHz regression coverage passed (13 tests).
- Premiere plan/XML: missing-behavior RED, then 10/10 GREEN. URL assertion corrected to use standards-compliant pathToFileURL ampersand plus XML escaping rather than requiring unnecessary percent-encoding.
- CLI: RED then 6/6 GREEN. Self-review found invalid sequence configuration was decoded before rejection; a new failing test drove upfront rate/dimension validation (7 tests).
- Panel controller: RED then 7/7 GREEN with a host double; no real host claim.
- Self-review: preserving all active scratch tracks would sum duplicated audio. Two failing tests drove reference-only default monitoring while retaining all source channels (12 adapter tests).
- Final local run: 75 transpiled TypeScript assertions + 7 native panel assertions passed. Full canonical repository checks remain a separate GitHub CI gate.
- Generated three-source file demo: 1.375s / 33 frames at 24fps recovered; independent XML structural validator passed (5 clipitems, 3 files).

Ruling: decoded samples may be uniformly peak-normalized if resampler overshoots exceed 1, preserving correlation without source writes; original files/channels remain the Premiere sources. Ruling: retain all audio channels but enable only the reference source by default; cost is manual enabling when monitoring another camera.
Deferred: long-file automatic window discovery, full-file VFR/timestamp certification, recording clock drift, subframe XML audio placement, native multicam source creation, signed installer, real-footage/host acceptance and independent review. No hidden deployment/merge.
