# Media Organizer runtime validation — 2026-10-13

## Baseline and scope

PR #17 was already merged into `feat/core-contracts` at `dcab8348ef8f1e4d83869e7169a7d3885027a837` when work started. Its three fixed review threads were then resolved. New work is on `codex/media-organizer-runtime`, based on that integration branch, not `main`.

This milestone adds real file providers, a SQLite catalog, a local helper and a Premiere development panel for registration/search/classification preview. It does not implement real Bin mutations or finish the v0.1 product.

## Measured results

Environment: macOS arm64, Apple M3 Max, Node 24.18.1, Premiere Pro 26.5.2, UXP Developer Tools 2.3.0. Existing local FFmpeg/ffprobe n4.4.1 binaries from the Sync worktree were used; no binary is committed or redistributed.

- Automated real-media workflow: 10 generated H.264 MOVs + 10 generated PCM WAVs, each 0.4 seconds. All 20 registered. Reopening SQLite preserved IDs, user-confirmed device and catalog contents. Rescanning returned 20 unchanged results. `Camera A` search and `Media Organizer / 2026-10-13 / Camera A / Video` classification passed. A corrupt MOV failed without creating an asset. Every original SHA-256 was unchanged afterward. Local artifact: `build/media-runtime-validation/report.json`.
- Actual Premiere panel: loaded `local.pea.media.organizer.dev` through UXP Developer Tools. Selected its local connection file; empty catalog restoration succeeded. Selected the same 20 files in the native picker; UI showed **등록 20개**, saved 20, search 20, revision 43.
- Actual UXP search: typing `01` reduced the 20 saved files to **샘플_01.mov**. Its date was `2026-10-13`, device missing.
- Actual metadata/preview: selected **샘플_01.mov**, entered `Camera A`, and saved. UI displayed **Media Organizer / 2026-10-13 / Camera A / Video**, **분류 준비됨**. These observations confirm Core/Zod/MiniSearch/BigInt catalog import in the host, not just a browser build.
- Tests cover SQLite restart, cross-connection CAS, invalid writes, unknown schema, corrupt documents and process-exit rollback of an uncommitted transaction; interrupted-job recovery; full-file hash/read-only behavior; exact decimal duration; unknown cadence/timezone; token/origin checks; duplicate registration; metadata retention; cancellation/concurrent writer rejection; invalid dates; project-switch/duplicate host-ID rejection.
- Runtime integration exposed an engine cancellation reporting defect: a provider rejecting after abort made the item `failed` while the job was `cancelled`. A failing regression reproduced it, then the catch path was corrected to return `cancelled` for an aborted provider call.

## Reuse and sources

Existing repository source at `e9e1c4c1345630ec9d859164a0859866177d998c`: process runner copied unchanged, chunked hashing and helper lifecycle patterns adapted, UXP bundle/connection-file/Premiere selection patterns adapted. Core, catalog codec, MiniSearch search and classification remain shared imports.

Primary API references: [Node SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [Adobe Project](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project), [Adobe ClipProjectItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem), [UXP filesystem recipe](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/filesystem-operations/).

## Limits and next gate

No actual project/Bin/timeline/source mutation was performed. Save As/reopen host identity stability and selected source extraction on a fixture project remain unmeasured. Automated helper restart is separate from a full Premiere restart test. CFR/VFR qualification, long/large real camera files, disk-full/permission failures, schema migrations, backups and installers remain unverified. A hard-killed CLI leaves a stale connection file; the documented recovery requires confirming the old helper is stopped and removing only that file.

The next implementation gate is a reviewed Premiere adapter with stable item bindings, owned Bin tracking, stale-plan rejection, actual apply/readback, repeat-run idempotence and Undo on an isolated fixture project. Preview success does not authorize or imply those writes.
