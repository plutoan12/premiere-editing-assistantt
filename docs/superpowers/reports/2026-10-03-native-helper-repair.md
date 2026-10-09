# Native Helper repair and verification record

Base: PR #9, `4258916b9b510392e8244c8f4da3dff59cd4b789`.
Plan: `docs/superpowers/plans/2026-10-03-native-helper-ffmpeg.md`.
Scope: repair and complete the helper boundary, not implement Premiere/UXP.

## Failures reproduced before repair

- Process/job regression batch: 12 cases, 7 failed, 5 already passed. Failures included
  pre-cancellation initialization, non-AbortError cancellation, a hanging job wait,
  publication of a late cancelled result, unsafe early deletion, mutable result
  exposure and missing job capacity.
- Media batch: 11 cases, 7 failed. Actual FFmpeg reproduced resampling discontinuity
  at a nonzero analysis origin. Other failures exposed missing input restrictions,
  sample validation, metadata validation and empty-window handling.
- HTTP batch: 8 cases, 7 failed. Audio/job routes were absent; origin/protocol and
  public-error protections were incomplete.
- Bootstrap: 2 initially failing cases for the missing private session lifecycle.

The tests were executed before their fixes. A Host-header test was corrected to
use node:http because the local fetch implementation did not send its override.
The old provider/probe mock tests now create regular local fixture files and supply
probe metadata, rather than bypass the newly required file boundary.

## Local evidence

Node 22.16.0, FFmpeg/ffprobe 7.1.5 on Linux.
42 local test cases passed, zero failed, zero skipped after repair and self-review.
Known MOV/PCM vs WAV offsets: expected +1487, measured +1487 samples; expected -1487,
measured -1487. HTTP job -> FFmpeg -> binary PCM -> Sync correlation measured +1487.
A different-origin window test and a 48 kHz -> 8 kHz continuity test also passed.
CLI smoke: health 200; token absent from stdout; exit code 0; session file removed.

Local dependency downloads were unavailable. The local runner transpiled the same
TypeScript with installed TypeScript and changed only Vitest registration imports
to node:test. Assertions are node:assert in both environments. This is not a claim
that the entire repository's Vitest suite ran locally. Full dependency/workspace
verification is the GitHub CI gate on the published head, recorded in the PR.
The separate offline boundary typecheck passed but does not replace that CI gate.

Fetched Sync runtime files used unchanged in local verification have these Git blob IDs:
- FFT: `4c3dce3e7edae300d6317d5f511c7cc6ffb0e230`
- Correlation: `bf97626a09348e60d1fbc7e4a08736614ab642c4`
- Audio boundary: `881cc19f9b6dad133d6caf7ae5d5b8a27e315e7f`
No Sync production source is modified by this repair.

## Decisions and costs

1. Continue the existing PR #9 rather than duplicate the helper. No main/base merge.
2. Count samples after decoding/resampling from origin. Cost: late windows can be
   slower or reach the explicit timeout; long-file scheduling remains future work.
3. Send binary PCM and retain bounded in-memory job results rather than base64 arrays
   or persistent artifacts. Cost: clients must retrieve results before helper restart.
4. Reject declared nonzero audio stream origins instead of silently guessing timeline
   offsets. Cost: those inputs need explicit origin mapping before automatic sync.
5. Use a private temporary session file for the development launcher. Cost: actual
   UXP bootstrap integration and macOS packaging are still release gates.
6. Author self-review was performed; no independent reviewer was available. An
   independent review and manual host acceptance remain advisable before release.

No deferred cosmetic changes were needed for this repair. Production footage,
Premiere execution, macOS install/relaunch and signing were not tested or claimed.
