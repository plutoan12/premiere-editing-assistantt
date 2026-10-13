# Media Organizer runtime connection

The user approved proceeding after PR #17. Its existing engine design remains the contract. This bounded runtime milestone connects real files and a Premiere development panel; it does not claim that Bin mutations, thumbnails, or production packaging are finished.

- [x] Confirm PR #17 merge into `feat/core-contracts`; resolve its three fixed review threads.
- [x] Add a SQLite `CatalogStore`: validated snapshots, compare-and-swap commits, durable restart, unknown schema rejection. The existing catalog codec preserves exact times and user edits.
- [x] Connect read-only chunked SHA-256 and ffprobe metadata to existing ingest. Reuse the same repository's process runner and native-helper patterns. Keep nominal frame rate distinct from verified CFR/VFR.
- [x] Add a loopback helper with a per-session bearer token, bounded inputs, serialized scans, cancellation, and an owner-only connection file. Support explicit files, never recursive or automatic project mutation.
- [x] Add a small Premiere UXP panel: connect, choose files/read selected source paths, register, search, classification preview, and restore from SQLite. Use existing engine search in the UXP bundle.
- [x] Test real generated media, restart/CAS/failure handling, and host panel loading. Record actual host results separately from automated tests.
- [ ] Review, push a new branch, and create a PR against `feat/core-contracts`.

## Decisions and reuse

- Native ffprobe follows the working Sync runtime already present on this computer. WASM/MediaInfo is still an alternative provider, not a second runtime to ship here. Cost: ffprobe and Node must be installed for this development milestone.
- SQLite stores one validated catalog snapshot transactionally. This reuses `exportCatalog`/`importCatalog` and avoids a second model. Cost: whole-catalog serialization per commit; measure before scaling beyond the current 500-item target.
- Reused repository source at `e9e1c4c1345630ec9d859164a0859866177d998c`: `apps/native-helper/src/process-runner.ts` (retained locally under `vendor` until branches integrate); chunk-read, loopback token/lifecycle, UXP build/connection-file and Premiere selection patterns. No Sync algorithms or Core contracts are duplicated.
- Runtime API is editor-independent. Only `apps/media-panel/src/premiere.ts` imports Premiere host behavior. Source files are opened read-only; no automatic XMP, Bin or timeline writes.

## Validation log

Implementation and exact results are recorded below as work completes.

- Storage/provider tests failed before implementation, then passed. HTTP registration/cancellation/date tests caught input identity reuse and provider-abort result issues; both were corrected with regressions. Full suite: 172 tests passed; full typecheck passed. UXP browser build and actual host register/search/edit/preview passed.

- Final review: three P2 findings fixed with RED→GREEN regressions: interrupted rescan validation, attached artwork media kind, and cached preview rows. Final suite 175/175. No deferred minors. Final validation details are in the runtime research report.
