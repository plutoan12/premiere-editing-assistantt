# Sync PR #2/#3 consolidation matrix — 2026-10-03

Canonical base: PR #2 / `feat/sync-engine` (`49c96f9`).
Safety source: PR #3 / `feat/sync-engine-implementation` (`5c23d8b`).
Consolidated branch: `feat/sync-consolidated`.

## Kept from PR #2

- Core-native `Provenance`, `SequencePlan`, `MediaTime` contracts.
- `syncClips(id, items, options)` as the canonical orchestration API.
- Signed reference-relative offsets rather than normalizing the earliest clip to zero.
- SMPTE label parsing and explicit clock/day identity.
- Provider interface `read(SyncEvidence, ProviderContext)`.
- Re-sync consumes Core `SequencePlan` rather than introducing a parallel segment model.

## Ported/hardened from PR #3

- Immutable snapshots of provider-owned PCM buffers before caching/correlation.
- Equal/repeated peaks remain ambiguous even when configured minimum margin is zero.
- Artificial search-boundary best matches are review-required.
- Peak exclusion radius cannot hide the configured search.
- Camera/source/role identity survives into Sync members.
- Playback batch returns one result per take, preserves successful takes after another provider failure, and caches one immutable master read.
- Full source occurrence plus a partial duplicate is treated as a re-sync conflict.
- Explicit root export surface; validation/FFT internals are not public API.

## Deliberately not ported

- PR #3 parallel `SyncResult`/normalized-earliest group model: conflicts with Core-native signed reference offsets.
- PR #3 `ResyncSegment` model: duplicates Core `SequencePlan`.
- PR #3 lower-case reason vocabulary: PR #2 canonical reason enum retained for compatibility.
- Direct FFmpeg, Premiere, UXP or HTTP behavior: belongs to later Native Helper/Adapter phases.

## Verification

TDD RED runs were observed in GitHub CI for safety regressions, workflow regressions, cached-master behavior, and explicit public exports before their fixes.
Latest consolidated head `7a770082cb151db993493738d1b6be00103556cf` passed GitHub Actions CI run 37107883136, whose workflow executes workspace `pnpm test` and `pnpm typecheck`.

This phase does not claim real-footage, FFmpeg, Premiere, UXP, packaging, or install validation.
