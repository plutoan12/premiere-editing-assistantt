# UXP Sync boot acceptance record

## Implemented / automatically checked

- Manifest v5, native `premierepro` / `uxp` loading and matching panel entrypoint.
- Static browser-safe bundle; missing native runtime produces a visible error.
- Controller analysis/review/dry-run/explicit Apply; one-shot private plan and defensive display copies.
- Stale source/project checks, cancellation and late-result isolation, readback of actual host-reported timeline positions.
- Synchronous locked transaction-scoped Actions; active sequence settings copied to a dedicated new sequence.
- Pinned template/source handles survive native sequence activation and selection changes.
- macOS-friendly, user-selected private folder transport; version/token checks; bounded JSON and decoder windows.
- Generated WAV/MOV decoded by real FFmpeg through file helper and controller to a Premiere fixture. Cancellation test checks that the owned decoder PID exits.

Local development evidence: 31 assertions passed using TypeScript transpileModule plus native node:test registration, including two enabled generated-container cases. This fallback is not the canonical Vitest suite or full-workspace TypeScript check. GitHub CI runs those separately.

## Manual acceptance — NOT RUN in this environment

- [ ] Record real macOS, Premiere and UDT versions.
- [ ] Load compiled manifest in UDT with Premiere Developer Mode enabled.
- [ ] Start the built Helper, select the fresh session folder, verify connection.
- [ ] Open a separately saved disposable test project and active template sequence.
- [ ] Run generated camera/recorder fixtures at known offsets; inspect Dry Run and zero pre-Apply mutations.
- [ ] Explicit Apply; inspect created sequence, actual waveforms/audio/slate and native readback export.
- [ ] Repeat with permitted real camera + external recorder footage and manually measured reference offset.
- [ ] Confirm relink/offline/changed source rejects stale Apply.
- [ ] Restart Premiere/Helper, reconnect new session, unload plugin and clean helper-owned session only.

Do not mark these checked using host fakes. No user footage or original .prproj is committed.

## Decisions / deviations

1. Retained current Core/Sync algorithm boundary and PR #8. No main merge.
2. Used selected-folder file jobs for the macOS panel because current Adobe docs restrict HTTP there. Existing HTTP routes remain unchanged. This adds one folder selection per helper launch instead of silently changing TLS trust/security.
3. Used active template settings rather than machine-default settings so the planned frame grid is preserved without relying on 26.2-only setters. Requires an active template sequence.
4. Panel exposes only audio/playback; clock metadata discovery and long-file/drift scheduling remain unimplemented and are not implied by this build.
5. Source change tokens use stat metadata, not a whole-file cryptographic digest. PCM hashes cover only analyzed windows.
6. Final review is author self-review; no independent reviewer or connected live Premiere runtime was available.

Minor deferred: persistent reconnect/discovery and progress UI polish. Signing/notarization/installer distribution are separate release work, not declared complete.
