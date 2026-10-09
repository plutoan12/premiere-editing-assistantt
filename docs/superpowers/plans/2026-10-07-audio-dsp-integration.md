# Audio DSP integration

Approved scope: repair PR #13 server registration, integrate the existing local Audio
Engine, and run complete tests/typecheck. The user subsequently authorized committing,
pushing and updating existing PR #13 on 2026-10-07. Preserve the prior Audio worktree
and all other worktrees; merging remains outside this change.

Base: PR #13 head `f079854d383b391cbcd50ec273f5da94b2503c50`.

1. Reproduce the missing DSP HTTP route and existing type errors.
2. Register measure/normalize in the existing authenticated job registry and shared
   operation limit. Configure render output only through trusted launcher options.
3. Bring in the previously reviewed `@pea/audio` package and add a native-helper
   loudness provider. Validate whole-stream scope, exact samples, native format,
   fingerprint, stream index, channel order and runtime identity before promotion.
4. Cover HTTP validation/cancel/limits, provider mismatch and cache separation, plus
   actual stereo and multiple-stream fixtures. Keep noise cleanup unsupported.
5. Run all workspace tests/typecheck; review the diff independently and fix findings.
6. Document results and remaining host/listening/reference-media verification.

Baseline evidence: the initial `pnpm typecheck` failed on missing `audioOutputRoot`
and two TS7022 errors in audio-dsp-http.test.ts. New route regression tests both
failed with HTTP 400 instead of 202 before the server fix; both passed after it.
Existing @pea/audio regression suite: 52 tests passed after copying into this base.

Dependencies use repository-pinned pnpm 10.17.1 with lifecycle scripts disabled.
A workspace lockfile records the combined dependency graph. FFmpeg/FFprobe are
external runtime requirements; executable availability and actual suite results
must be reported separately from unit tests.

Completion evidence (2026-10-07): after user-approved task-local FFmpeg 4.4 /
FFprobe n4.4.1 installation, all 207 tests passed (24 actual-media tests included),
all workspace typechecks passed, and git diff --check passed. Independent review
reported no remaining Critical/Important findings after the CRLF runtime fix.
See ../../verification/2026-10-07-audio-dsp-integration.md for environment and commands.
