# Native Helper implementation evidence — 2026-10-03

Base: `feat/core-contracts` at `131f0505199349f4807953f78d8512f81bc7e1db`.
Scope: local Node helper, FFmpeg boundary, consolidated Sync adapter, HTTP protocol,
private bootstrap, development bundles, generated-media CI. No changes to Sync,
Core, main, the transcript PR, or separate FFmpeg/Premiere experiment branches.

## Local evidence

- 68 tests, 68 passed, 0 failed/skipped: process, path, real decode, Sync pipeline,
  queue, HTTP, bootstrap, and cancellation ownership regression.
- An additional real-time-paced input characterization confirms a short-window decode
  stops before consuming the entire recording; no production change was needed.
- Real installed FFmpeg 7.1.5 decoded generated WAV and MOV files.
- Known shifts +500 and -500 analysis samples recovered by the consolidated engine.
- Repeated signals remain review; a failed target preserves a valid candidate.
- CLI process smoke: localhost probe -> real WAV decode -> Sync -> exact `"500"`
  JSON timing -> SIGTERM -> session cleanup. Token was not printed.
- Static local boundary typecheck and `git diff --check` exit 0.

The container cannot resolve GitHub/npm. Local tests keep the assertion bodies but
replace Vitest describe/it registration with native Node registration and transpile
with installed TypeScript 5.8.3. This is NOT installed-workspace Vitest/build proof.
Consolidated Sync runtime sources were fetched from GitHub; hashes of sync.ts,
types.ts, audio-correlation.ts, fft.ts and time-math.ts match the base blobs.
The local boundary typecheck uses mirrored Core type declarations; only remote
workspace CI counts as the real dependency/typecheck acceptance gate.

## Review and rulings

Author self-review, not an independent reviewer. The review found that Core can
release an aborted caller before its decoder terminates. A new regression failed
first; the helper now awaits outstanding provider cleanup before releasing the job.
The boundary typecheck also caught a Promise<void> callback returning ServerResponse;
that return was removed, followed by passing tests and typecheck.

Rulings: explicit bounded windows rather than unverified long-file search; macOS/
Linux descriptor transport rather than an untested Windows fallback; remote CI for
full installed-workspace validation. Costs: scheduler, Windows adapter, and actual
Premiere/production acceptance remain separate work. No source media was uploaded
or committed. No binary redistributable licensing or signing claim is made.

## Remote gates

A dedicated workflow runs whole-workspace tests/typecheck, generated-container
integration, bundle build, and bundled-launcher smoke on Ubuntu and macOS. The PR
must report actual run IDs and conclusions. This report does not pre-claim success
for a workflow that has not run. UXP installation and real production-footage
acceptance are not replaced by these checks.
