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

Final independent review found a capacity boundary: creating Bins could exceed the host reader's 10,000-item ceiling and prevent restoration reads. The plan now counts distinct missing path prefixes and rejects that operation before any mutation. A 9,998-item regression was observed failing and then passing. A separate partial-move regression verifies recovery when one of two host moves succeeds before the transaction throws. The Stop button is enabled only during cancellable helper work, never while host transactions or restoration are running.

Real ffprobe/helper verification against the generated H.264 source returned `verified: true` at catalog revision 7, with identical source hashes before/after (`build/media-bin-helper/validation.json`). All 192 tests, typecheck and panel build passed locally and in GitHub CI on `e4a6df6`.

## Product-panel reload acceptance completed (2026-10-27)

The product buttons were used to review and apply the one-file catalog (revision 7) in the generated-media project. The UI showed `샘플_01.mov` under `Media Organizer / 2026-10-13 / Camera A / Video`. The isolated helper was stopped before the restore check.

Screen automation initially failed with `noWindowsAvailable`; a fresh app binding and current accessibility snapshot recovered access, and the user unlocked macOS when required. Use a fresh snapshot after switching windows, target Premiere 26.5.2 explicitly when the Beta is also running, and use Shift+1 to focus the project panel. No automation-tool implementation was changed.

Reopening the saved fixture exposed a product defect: Premiere returned the Korean project directory in NFD while the saved journal key contained NFC. Read-only UXP diagnostics confirmed the same project GUID, root ID, clip ID/name and source path; only the project path representation differed. The panel incorrectly reported no restore record.

The Mac adapter now canonicalizes project paths to NFC. The journal store reads earlier NFC/NFD/mixed-path records only for the same GUID and normalized full path, and rejects conflicting records. A separate canonical storage key is saved and verified before inverse actions; completed restores take precedence over retained legacy keys. Windows paths remain exact, and Save As, different GUIDs, source paths, item IDs and collision checks retain their existing guards. Platform detection uses Adobe's documented [`os.platform()`](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/host-info/).

Five regression cases were observed failing before this fix. The final suite passes all **200 tests**, including legacy NFC/NFD/mixed paths, different-project isolation, Windows path distinctions, conflicting legacy records, and no host mutation when a migrated journal write fails. Workspace typecheck, the UXP panel build, and `git diff --check` also pass.

Final UI check in Premiere **26.5.2**, using the original persisted applied journal:

1. Confirmed `build/media-bin-helper/connection.json` was absent and the helper remained stopped.
2. Reloaded the newly built product panel using UXP Developer Tools; it reported **Plugin Reload Successful**.
3. Without connecting the helper, clicked **최근 분류 되돌리기**. The panel displayed **클립을 원래 Bin으로 복원했습니다.**
4. Focused the project panel with Shift+1. The screenshot showed `샘플_01.mov` directly under `Media Bin Acceptance.prproj`; all four created Bins were gone. No sequence existed.
5. Saved the owned test project in the restored state.

The remaining product-button acceptance is complete. This qualifies this generated one-clip Mac fixture, including a real panel reload and project reopen; it does not qualify Windows, shared projects, a populated timeline, or crash/power-loss durability.
