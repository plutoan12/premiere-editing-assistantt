# Subtitle Engine Implementation Plan

**Goal:** Produce editable, lineage-preserving transcripts/captions and localized variants.

## Tasks
1. STT provider orchestration and artifact caching.
2. Speaker diarization mapping with UNKNOWN fallback.
3. Segmenter enforcing configurable max chars/lines/duration without rewriting words.
4. Timing refinement using word timestamps where available; preserve source timebase.
5. Correction stage that records original text + corrected text + reason/provenance.
6. Translation stage producing child segments linked to master segment IDs.
7. Caption decision builder for Premiere adapter.
8. Prompt files: `prompts/subtitle/correction-v1.md`, `translation-v1.md`, structured output schemas and fixtures.
9. Provider timeout/retry/cancellation tests.
10. Public API and CI.

**Tests:** overlapping speakers, missing word timestamps, punctuation-only correction, proper nouns/glossary, segment split/merge lineage, translation failure, RTL/CJK text preservation.

**Completion:** master transcript is never overwritten by translated/corrected derivatives; every derivative can trace back to exact master segments.
