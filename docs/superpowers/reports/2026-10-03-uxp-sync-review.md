# UXP Sync Review implementation record

Base: repaired Native Helper PR #9, commit 1f8949e9c62322450e5cdc97a29f7b646bc2662e.
Work branch: feat/uxp-sync-review. Draft PR #12, stacked on PR #9.

## Delivered scope

Analysis-only UXP panel in apps/premiere-sync-panel. Reuses apps/native-helper for actual audio reads and packages/sync for the canonical algorithm. Added authenticated Sync jobs, exact decimal-string result transport, optional Node HTTPS listener and an explicit TLS CLI configuration. Added capability handshake, immutable project/selection snapshot, explicit reference, cancel/poll/retry controls and reviewed JSON export. No timeline Apply or media mutation code exists in the panel.

## Recorded gates

- Initial server tests: GitHub CI 37112546360 observed four expected failures: missing Sync capability, two rejected Sync-job cases, and lack of HTTPS. Existing suites remained green.
- Backend implementation head 4a8b3c72b2407bb420588c283d9fb67fe0c6a284: GitHub CI 37113005729 succeeded.
- Local panel tests use actual Node test registration (no framework emulation): initial missing-module RED, then 20 passing behavior tests. Self-review added two timing regressions; both failed before the controller fix. The package structure gate was also checked before adding the runtime files. Final local panel total at publication: 23 passing tests, zero skipped.
- TLS CLI tests locally passed using the identical assertions with Node registration and transpiled source. This is not an installed-workspace TypeScript check.
- The new panel-client end-to-end test invokes a real HTTPS server, a fixture-scoped trusted certificate, actual FFmpeg, and the same panel client/controller against generated audio with a known +733-sample offset. Remote result is pending at publication; consult the PR body and final CI head before treating it as verified.
- Dedicated CI runs all workspace tests, TypeScript checks, panel JavaScript syntax checks and development-folder packaging on Ubuntu and macOS. No production footage or private keys are stored in artifacts.

## Design rulings and limits

Adobe's current Premiere recipe restricts HTTP on macOS. The panel requires literal HTTPS IPv4 loopback, a 64-hex-character token, protocol 1 and Sync capability; redirects are forbidden. TLS verification is not bypassed and no CA is installed. Users must supply a trusted certificate/key; their host trust is a remaining acceptance gate.

The existing Helper's browser-Origin rejection is preserved. Actual UXP Origin behavior, arbitrary-port manifest matching, file-picker permissions and host selection behavior must be measured in Premiere. Reference docs are not proof of host execution.

Selection is project-item based. Results are relative to original file zero, not timeline clips, In/Out, subclips or retimed/proxy regions. Basic UI compares at most the first 20 seconds of the first audio stream as mono 8 kHz. Full-length discovery and drift correction are not supplied. The host check does not continuously detect external same-path file content changes; final Apply would require stronger media revision checks.

Unknown submission outcomes are deliberately not retried. Polling failures retain known job handles. Cancellation suppresses completed reports even during final host validation. Backend cancellation waits for owned decoder cleanup. The underlying bounded FFT is synchronous in the Helper, not in the UXP thread.

Review is author self-review, not an independent reviewer. No merge, release, signed CCX, trust-store modification, user-Mac installation, real Premiere run or production-footage accuracy claim.
