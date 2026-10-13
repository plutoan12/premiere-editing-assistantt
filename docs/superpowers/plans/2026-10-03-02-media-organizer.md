# Media Organizer Implementation Plan

**Goal:** Convert raw media metadata and optional semantic analysis into stable bins, tags and searchable records.

**Inputs:** MediaAsset[], MediaProbeProvider, optional STT/Vision providers.
**Outputs:** MediaMetadata, BinPlan, AnalysisTag[], SearchDocument[].

## Tasks
1. `probe.ts` — normalize codec/container/duration/frame-rate/audio-channel metadata.
2. `bins.ts` — deterministic rules for camera/date/audio/type bins; configurable naming.
3. `scene-take.ts` — parse metadata/file naming/slate hints without assuming a single camera vendor.
4. `tags.ts` — merge deterministic + AI tags while preserving provenance/confidence.
5. `people-speech.ts` — map optional speaker/person labels to media ranges; no biometric identity claims by default.
6. `search.ts` — query normalized metadata/transcript/tag documents; provider-independent interface.
7. Cache analysis by MediaFingerprint + analyzer version.
8. Public API + fixtures + CI.

**Tests:** duplicate filenames with different fingerprints, missing metadata, VFR media flagging, no-audio clips, AI disabled, provider failure preserving deterministic results.

**Completion:** identical inputs/config produce identical deterministic organization; optional AI failure never blocks basic ingest.
