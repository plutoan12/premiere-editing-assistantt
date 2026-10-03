# Premiere Rough Cut Hybrid Implementation Plan

> **For agentic workers:** implement task-by-task with TDD and verify the whole workspace before claiming completion.

**Goal:** Deliver a review-gated macOS Premiere rough-cut flow from selected clip to a newly created sequence.

**Architecture:** Keep deterministic editorial logic in `@pea/rough-cut`. Add bounded PCM decoding behind a provider interface, with AVFoundation for macOS/Hybrid and the existing FFmpeg/helper path as fallback. Premiere-specific dry-run/apply behavior stays in an adapter and the panel owns review/approval.

**Tech Stack:** TypeScript, Vitest, Premiere UXP, Adobe Hybrid C++ addon, AVFoundation, existing Node helper/FFmpeg.

**Spec:** `docs/superpowers/specs/2026-10-03-rough-cut-premiere-hybrid-design.md`

## Global Constraints
- Source media is read-only.
- Unreviewed candidates are kept.
- Apply creates a new sequence only.
- V1 is one selected CFR 1x clip with linked audio/video.
- Hybrid requires Premiere 26.2+; 25.6+ helper fallback remains valid.

## Review Focus
- One-channel speech must prevent a silence cut.
- Opposite-polarity channels must not cancel into false silence.
- Protected/user-kept ranges must override removal.
- Stale Premiere project state must reject Apply.
- Unsupported retime/VFR/missing-audio inputs must fail explicitly.

### Task 1: Rough-cut package
Create `packages/rough-cut` with PCM silence detection, review resolution, conservative frame quantization and SequencePlan construction. Add Vitest coverage for Review Focus audio/range cases.

### Task 2: Media provider contract and helper endpoint
Add a bounded PCM provider contract and authenticated `/v1/audio/window` helper endpoint. Reuse the existing job/cancellation and FFmpeg boundary rather than putting process APIs in the engine. Tests cover body limits, auth, cancellation, no-audio and bounded output.

### Task 3: macOS AVFoundation provider
Add the Hybrid/native addon source and build metadata. Decode selected audio using AVAssetReader to Float32 PCM with explicit channel/sample metadata and source timing. Add a macOS-only acceptance harness; CI may skip only this host-specific acceptance with an explicit reason.

### Task 4: Premiere rough-cut adapter
Add `adapters/premiere-rough-cut` with pure dry-run validation and explicit apply operation descriptions. Capture project/sequence fingerprint at dry-run and reject stale Apply. Reject VFR/retime/unsupported mappings.

### Task 5: UXP review flow
Extend the panel with selected-clip discovery, Analyze, progress/cancel, candidate Keep/Remove controls, Dry Run and Apply. Do not apply until every removal is explicit and dry-run is current.

### Task 6: Packaging and verification
Package CCX, include Hybrid addon only for compatible hosts, keep helper fallback, run workspace tests/typecheck and generated-media acceptance. Document manual gates for real Premiere playback, signing/notarization and permitted real footage.

### Completion gate
No “complete” claim until fresh workspace tests/typecheck pass. Host-only gates that cannot run in CI must be named as unverified rather than inferred.
