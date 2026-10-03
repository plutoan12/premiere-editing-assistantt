# UXP Sync Review Implementation Plan

**Goal:** Extend the repaired PR #9 Helper with a HTTPS-capable, analysis-only Sync panel. Reuse its process runner, PCM provider, job registry and consolidated @pea/sync; do not introduce another helper runtime.
**Architecture:** Existing apps/native-helper owns PCM and syncClips. apps/premiere-sync-panel is a small CommonJS UXP client with pinned project selection and an explicit reference. Protocol v1 retains decimal-string times, bounded jobs and authentication. The panel only accepts HTTPS loopback sessions. No project mutation or Apply is implemented in this slice.
**Tech stack:** Node 22, existing TypeScript/Vitest, native Node tests for the unbundled UXP CommonJS client; no new runtime dependencies.
**Spec:** docs/superpowers/specs/2026-10-03-premiere-local-pipeline-design.md
**Execution:** Direct implementation, continuing the user's approved local-helper design.

## Rulings
- Keep PR #9 at 1f8949e as the parent. PR #11 is a competing helper, not an additional dependency. PR #10's bootstrap/file-picker/poll/cancel UXP pattern informs this Sync-specific panel; do not overwrite its transcription workflow.
- Adobe's current Premiere network recipe explicitly restricts HTTP on macOS. Add Node HTTPS support and require user-supplied certificate/key for the CLI; do not install trust anchors, generate production identities, disable verification or silently fall back to HTTP. Explicit development HTTP remains available to existing tests.
- Capture project-item IDs and original file paths, not timeline placements. Results refer to original file zero, not in/out points, subclips, proxies or retimed timeline clips. State this in the UI. Reject offline/sequence/merged/multicam items; invalidate reviewed results on project/selection change.
- Automatic Apply, subtitle integration, long-recording discovery, signing/notarization and actual Premiere execution remain separate acceptance gates.

## Tasks
- [ ] 1. Add RED tests for Sync jobs, capability handshake and real TLS verification; add strict bootstrap/client/controller/selection tests.
- [ ] 2. Implement validateSyncInput and runSyncJob in apps/native-helper/src/sync-job.ts; bounded 2..16 files, explicit reference, sample windows, exact JSON time transport, partial/review preservation, decoder cleanup after abort.
- [ ] 3. Extend existing server, bootstrap and CLI with optional TLS key/cert; expose sync job kind and capabilities. Keep Host/Origin/auth guards and existing audio job behavior unchanged.
- [ ] 4. Implement panel client.js, controller.js and selection.js plus UXP main.js/manifest/index/style. Gate connection after authenticated capability handshake, prevent duplicate submission, handle cancellation while submission is in flight, suppress late results, preserve unresolved job handles for status retry, export review JSON only after selection revalidation.
- [ ] 5. Run full workspace tests/typecheck and required FFmpeg integration; run real TLS + generated-media client end-to-end tests. Package a development panel ZIP, not a .ccx installer. Record exact commands/results and remaining host gates.

## Review focus
TLS without a trusted certificate must fail; a redirected or malformed bootstrap must never receive a bearer token; cancellation during POST must cancel the returned job; a network error must never resubmit a job; changed project/selection must invalidate review/export; no fake percentages or timeline Apply claims.

## Official references checked 2026-10-03
- https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network/
- https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectutils
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectitemselection
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem
- https://nodejs.org/api/https.html
