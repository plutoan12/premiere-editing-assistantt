# Subtitle review integration

Date: 2026-10-07

## Scope

Continue the user's Subtitle design and instruction to reuse GitHub code. Source dialogue search and edited-sequence captions have equal priority. Baseline is helper/transcript integration commit 9c1c9c0143a6afb7b9f283c981faf7ae80091d34, not the documentation-only main branch. This increment reuses @pea/core, @pea/transcript, @pea/premiere-transcript and @pea/helper-protocol.

The user requested implementation continuation on October 7. Work runs in an isolated worktree, preserving other modules and branches. New code supplies the missing review workflow instead of recreating the existing recognition engine or subtitle parser.

## Deliverables and checks

1. Versioned subtitle documents: retain imported master and raw Adobe JSON; immutable correction revisions; text, speaker and time edits; explicit split/merge; JSON save/open with lossless bigint time. Test malformed documents, references and edits; the prior document remains unchanged.
2. Source and sequence clocks: require an explicit sequence start offset for rendered sequence audio/subtitles; export quantizes only at SRT/VTT boundary. Search returns current corrected source segments. No inferred mapping from an edited sequence back to raw clips.
3. Pinned Premiere selection: resolve exactly one source clip and its project identity before awaiting host transcription; reuse the existing Adobe adapter; reject project switches and sequences.
4. Helper provider: reuse authenticated HTTPS client; submit/poll/cancel with bounded waits; validate result identity, states and wire time. Never accept a late completion after cancellation or silently retry speech analysis.
5. Review panel: separate staged UXP panel to avoid modifying the shared rough-cut/transcription panel. Import SRT/VTT, open/save subtitle documents, search library, review/edit/split/merge cues, export SRT/VTT, load a pinned Premiere source transcript, or transcribe selected source/sequence-rendered media via configured helper.
6. Verify existing workspace baseline, focused RED/GREEN checks, workspace tests/typecheck and browser-target bundle. Review the change independently. Record unrun host/model checks.

## Boundaries

- No model or FFmpeg redistribution, automated model downloads, paid APIs or media uploads.
- Existing Premiere transcripts are read by default; a separately labeled action explicitly requests host transcription.
- A sequence file is already rendered audio/video supplied by the editor, with an explicit start time. Automatic sequence export, caption-track creation and Graphics/MOGRT integration are follow-up work.
- Saved documents identify the input snapshot; they do not imply Media Organizer catalog registration or automatic cross-file identity.
- Source media and existing Premiere captions are not modified.
- Actual Premiere loading, UXP file dialogs and real speech quality require host/binary/model acceptance; a green mock or browser test does not establish them.

## Progress

- Worktree created from the exact baseline; original checkout unchanged.
- Dependency install uses the existing workspace constraints and local pnpm cache, with lifecycle scripts disabled.
- Completed document model, session and exact time editor, pinned Premiere source loader, helper provider, standalone UXP view, saved-file fixture and developer build.
- Independent review fixed source relinking during transcription and a hide/show race that unlocked editing while a file write was still pending. Both fixes have failing-then-passing regressions.
- Transcript package: 87 tests pass. Subtitle panel: 67 tests pass, including real loopback transport and bundled view tests with explicit host/DOM substitutes.
- Final full-workspace run: 310 tests pass, 2 fail in the pre-existing FFmpeg-dependent rough-media tests, 2 native/model tests skip. All 12 package typechecks pass; browser-target build, bundle syntax and diff checks pass.
- Actual Premiere panel loading was attempted but not confirmed because another active task was operating the shared development tools. No Subtitle project changes were made. Host and actual speech-model acceptance remain open; see the acceptance document.
