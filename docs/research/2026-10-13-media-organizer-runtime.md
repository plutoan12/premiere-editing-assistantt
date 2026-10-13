# Media Organizer runtime validation — 2026-10-13

## Baseline and scope

PR #17 was already merged into `feat/core-contracts` at `dcab8348ef8f1e4d83869e7169a7d3885027a837` when work started. Its three fixed review threads were then resolved. New work is on `codex/media-organizer-runtime`, based on that integration branch, not `main`.

This milestone adds real file providers, a SQLite catalog, a local helper and a Premiere development panel for registration/search/classification preview. It does not implement real Bin mutations or finish the v0.1 product.

## Measured results

Environment: macOS arm64, Apple M3 Max, Node 24.18.1, Premiere Pro 26.5.2, UXP Developer Tools 2.3.0. Existing local FFmpeg/ffprobe n4.4.1 binaries from the Sync worktree were used; no binary is committed or redistributed.

- Automated real-media workflow: 10 generated H.264 MOVs + 10 generated PCM WAVs, each 0.4 seconds. All 20 registered. Reopening SQLite preserved IDs, user-confirmed device and catalog contents. Rescanning returned 20 unchanged results. `Camera A` search and `Media Organizer / 2026-10-13 / Camera A / Video` classification passed. A corrupt MOV failed without creating an asset. Every original SHA-256 was unchanged afterward. Final local artifact: `build/media-runtime-validation-final/report.json`. A separate generated MP3 with attached JPEG cover artwork was also registered as audio, with its source hash unchanged.
- Actual Premiere panel: loaded `local.pea.media.organizer.dev` through UXP Developer Tools. Selected its local connection file; empty catalog restoration succeeded. Selected the same 20 files in the native picker; UI showed **등록 20개**, saved 20, search 20, revision 43.
- Actual UXP search: typing `01` reduced the 20 saved files to **샘플_01.mov**. Its date was `2026-10-13`, device missing.
- Actual metadata/preview: selected **샘플_01.mov**, entered `Camera A`, and saved. UI displayed **Media Organizer / 2026-10-13 / Camera A / Video**, **분류 준비됨**. These observations confirm Core/Zod/MiniSearch/BigInt catalog import in the host, not just a browser build.
- Tests cover SQLite restart, cross-connection CAS, invalid writes, unknown schema, corrupt documents and process-exit rollback of an uncommitted transaction; interrupted-job recovery; full-file hash/read-only behavior; exact decimal duration; unknown cadence/timezone; token/origin checks; duplicate registration; metadata retention; cancellation/concurrent writer rejection; invalid dates; project-switch/duplicate host-ID rejection.
- Runtime integration exposed an engine cancellation reporting defect: a provider rejecting after abort made the item `failed` while the job was `cancelled`. A failing regression reproduced it, then the catch path was corrected to return `cancelled` for an aborted provider call.

## Reuse and sources

Existing repository source at `e9e1c4c1345630ec9d859164a0859866177d998c`: process runner copied unchanged, chunked hashing and helper lifecycle patterns adapted, UXP bundle/connection-file/Premiere selection patterns adapted. Core, catalog codec, MiniSearch search and classification remain shared imports.

Primary API references: [Node SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [Adobe Project](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project), [Adobe ClipProjectItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem), [UXP filesystem recipe](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/filesystem-operations/).

## Limits and next gate

No actual project/Bin/timeline/source mutation was performed. Save As/reopen host identity stability and selected source extraction on a fixture project remain unmeasured. Helper stop/start plus UXP panel reload/reconnection restored the 20 files and saved Camera A classification in Premiere; a full Premiere application restart remains untested. CFR/VFR qualification, long/large real camera files, disk-full/permission failures, schema migrations, backups and installers remain unverified. A hard-killed CLI leaves a stale connection file; the documented recovery requires confirming the old helper is stopped and removing only that file.

The next implementation gate is a reviewed Premiere adapter with stable item bindings, owned Bin tracking, stale-plan rejection, actual apply/readback, repeat-run idempotence and Undo on an isolated fixture project. Preview success does not authorize or imply those writes.


## Final review and checks

One independent read-only branch review found three P2 issues. All were fixed with failing-then-passing regressions in one repair pass:

1. Interrupted rescans now fail their running scan records, discard their resumable analysis-cache references, and mark associated sources unverified. A real byte replacement followed by simulated interrupted state and reopen is blocked from plans; retry updates content while preserving ID, prior artifact until success, and user edits.
2. ffprobe `disposition.attached_pic` video streams are excluded from primary video selection, keeping music with embedded cover artwork in Audio. Confirmed by both normalized-data regression and a generated MP3/JPEG file.
3. Preview plans are computed once per accepted catalog, and query rendering selects prepared rows. The prior per-hit plan rebuilding took about 2,982ms for 500 minimal files in the review reproduction. The committed benchmark measured preparation mean 30.0572ms (10 samples); query/search/result-string formatting mean 1.1245ms, p99 1.3487ms (200 samples). These are Node measurements, excluding UXP DOM painting, not claimed Premiere UI timings. Run `pnpm --filter @pea/media-panel exec vitest bench --run src/preview.bench.ts`.

Final automated suite: 175 tests (Core 26, Sync 51, Media 77, helper 17, panel 4); full typecheck and UXP bundle build pass. No minor review findings were deferred.
