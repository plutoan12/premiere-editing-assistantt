# Premiere Bin apply and restore

The requested milestone connects the existing reviewed classification to real Premiere Bin actions. The engine remains editor-independent. Premiere-specific object access lives in `apps/media-panel/src/bin-host.ts`; classification and preflight reuse `@pea/media-organizer`.

## User flow

1. Register source files and confirm their date/device in the Media Organizer panel.
2. Select up to 500 online original clip items in the Premiere project panel. Save the project first.
3. **선택 클립 적용안 확인** lists only the selected items that need moving, with the exact destination path. Missing/uncertain classification, sequences, bins, ambiguous registered locations or duplicate destination names block the plan.
4. **확인한 분류 적용** verifies the reviewed catalog revision and the original source SHA-256 via the local helper, then creates/reuses the destination Bins and moves the selected items.
5. **최근 분류 되돌리기** restores original parent IDs, then removes only recorded, unchanged, empty Bins created by this operation. Renamed/nonempty Bins are retained and reported. Conflicting clip edits or missing/changed original parents block restoration before any move.

A new nonempty apply replaces the latest undo record for that project. Repeated apply at the target is a no-op and does not replace the record. Interrupted apply/restore must be restored before another apply. The record is scoped to project GUID **and file path**; Save As does not inherit authorization to mutate the copy.

## Persistence and failure behavior

The inverse journal is written to UXP localStorage and read back before the first host mutation. Original positions and all destination IDs are stored before the move transaction. It is parsed with a versioned strict schema on reload. A failed journal write stops further host mutations. This is plugin-local persistence, separate from the SQLite media catalog, and does not promise power-loss durability; clearing plugin data removes the record.

Bin creation needs intermediate host reads to obtain IDs, so the entire operation is **not a single Premiere Undo entry**. Each creation, the compound clip move and each empty-bin cleanup is a labeled native undoable transaction. The panel's restore button performs guarded inverse actions rather than invoking global Undo, which could reverse unrelated editing work.

After interrupted creation before the returned Bin ID was recorded, that Bin is conservatively retained and reported. Partial or failed moves remain recoverable from the preceding journal. Native Undo that has already restored an item is recognized without moving it again. The operation does not auto-save the user's project, import files, modify source media, set source In/Out, edit metadata/XMP, or change the timeline.

All Action creation and execution happens inside `lockedAccess`; no async callback is passed to a lock or transaction. Async discovery is followed by synchronous ID/name/parent checks. Host state is read before each phase and the results are read back. Simultaneous editing during a multi-phase operation is not supported: a detected change stops it and leaves the journal for inspection/restore. Shared-project/Team Projects behavior and crashes during host commit remain unqualified.

## Reuse and sources

- Existing engine: `buildOrganizationPlan`, `HostApplyPlanSchema`, `preflight`, catalog metadata overrides and exact-location asset mapping.
- Existing repository Sync adapter: locked transaction and readback pattern (same repository, `e9e1c4c1345630ec9d859164a0859866177d998c`).
- GitHub code search `createMoveItemAction repo:AdobeDocs/uxp-premiere-pro-samples` located [Adobe's projectPanel.ts](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/b481f1462400ddec5a7399e4930fafd7f71c58d0/sample-panels/premiere-api/src/projectPanel.ts). Read `createBin`, `moveItem`, `removeItem`, and `getParentBin` usage. API patterns were reimplemented with our identity, review, failure and ownership guards; no Adobe source file was copied.
- Official references: [FolderItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/folderitem), [Project transactions/locks](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project), [ProjectItem IDs/parents](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectitem).

## Validation

Automated cases cover source changes, stale catalog/project/path/tree, unconfirmed classification, duplicate destination names, lock-scoped native calls, transaction refusal, exact restoration, persisted reload, no-op repeated application, interrupted application, native-Undo observation, changed original parents, preserving user additions and failed journal persistence. Initial feature tests were observed failing before implementation; the source verification endpoint initially returned 404 and passed after implementation.

Actual Premiere 26.5.2 acceptance on 2026-10-13 used a fresh generated-media project. Native readback confirmed one selected source moved into four newly created Bins, repeated application produced zero moves, a new journal-store instance restored the original tree exactly, all four created Bins disappeared, and sequence count remained zero. Report: `build/media-bin-host-1791880177000/report.json` (`passed: true`). This fixture had no timeline; it does not qualify preservation of a populated timeline or Windows operation.

Host harness: `pnpm --filter @pea/media-panel exec node scripts/build-host-test.mjs`, then load the printed manifest in UXP Developer Tools and click **Run owned fixture**. It imports only the previously generated sample `build/media-runtime-validation/sources/샘플_01.mov` into a fresh timestamped test project. Its full-filesystem test permission is isolated from the shipping development panel's request-only permission.
