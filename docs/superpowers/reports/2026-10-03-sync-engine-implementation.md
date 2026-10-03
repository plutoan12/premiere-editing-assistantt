# Sync Engine implementation report — 2026-10-03

Base: `feat/core-contracts` at `c76071568cfb469009fbbf973fd06fbaa78661f7`.
Approved plan: `docs/superpowers/plans/2026-10-03-01-sync-engine.md`.
Scope: Sync Engine only; other engines and the Premiere panel remain separate.

## Delivered

Contracts and public exports; exact compatible timecode offsets; audio provider
boundary; bounded normalized FFT correlation; timecode/audio/review orchestration;
multicam interval grouping; independent playback takes with a cached master;
source-anchored re-sync with mapped/unmapped/conflicted output.

Source media is never changed. No new runtime dependency or external AI service.
`@types/node` is a development-only dependency for explicit Node assert imports.

## Test-first evidence

- Existing source SHA: GitHub CI run 37087161237 succeeded.
- Before implementation: 64 cases, 58 failures exposing missing behavior and
  missing APIs; 6 existing behaviors passed.
- First implementation: 64/64 passed.
- Author self-review added 7 cases; 5 failed, reproducing equal-peak acceptance,
  excessive exclusion radius, reused reference/cache buffers and partial repeats.
- After fixes: 71/71 passed; independent direct sums agree with FFT products.
- Offline boundary typecheck and `git diff --check` passed.

Offline local execution uses the identical Node assert test bodies with Node's
native describe/it in place of Vitest imports. Boundary type declarations mirror
fetched Core time schemas. These checks are NOT a substitute for full workspace
Vitest and TypeScript; GitHub CI on the PR is the release gate.

## Implementation rulings

1. Preserve module delivery order instead of implementing all seven engines at
   once. Cost: the other modules remain planned, not implemented here.
2. Require timebase/frame-rate metadata rather than accepting legacy bare ticks.
   Cost: pre-0.1 callers must supply the explicit metadata.
3. Search every bounded lag via FFT, then directly refine peaks instead of a
   decimated coarse grid that can miss a narrow match. Cost: bounded allocations;
   long-file window selection stays outside the matcher.
4. Source-anchored re-sync accepts only a unique full 1x mapping. Cost: partial
   trims, duplicated regions and retiming need review rather than approximate
   automatic propagation.
5. Author self-review was used because no independent reviewer was available.
   This is weaker than independent review; no merge is performed by this work.

## Not claimed

No real-footage accuracy percentage, full-length drift correction, concrete media
decoder, LTC parser, voice-level subtitle/dubbing alignment, Premiere integration,
macOS install, publication, or merge. See the package README for host obligations
and remaining integration work.
