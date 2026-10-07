# Premiere Graphics: host integration follow-up

The user approved the next real-Premiere integration step and publication to GitHub.
Use the existing `feat/graphics-engine` worktree and PR; preserve other engine work.
No extra dependencies, Core changes or existing-project edits are needed.

## Evidence and scoped implementation

Premiere 26.5.2 and UXP Developer Tools are installed. Adobe's UXP API supports
MOGRT insertion, transactions, string ticks and sequence settings. Live exploration
in a newly created test project inserted both Basic Lower Third and an AE Gaming
Lower Third. After loading, the AE Capsule component appeared, but title/subtitle
keyframe values were null; the native template initially had no exposed text component.
In the final replay, its text components appeared after loading, but source-text values
remained unavailable to the inspector.

Therefore this increment implements an explicitly named **template preview**, not
full caption rendering. Do not enable the compiler's captionLayout/emphasis flags.
Full text/style/placement application remains blocked on a tested text renderer.

1. Convert a validated GraphicsPlan decision and exact-version binding to a limited
   preview request. Preserve physical frame timing through bigint tick conversion.
2. Validate the UXP request before edits, create a new sequence, set and read back
   dimensions/frame ticks, require empty destination tracks, import, trim and read back
   clip ranges. Return incomplete-mutation receipts; never silently retry.
3. Provide a development panel for template/request selection, preview, parameter
   inspection and receipt export. Use only file-picker permissions. Build with existing
   TypeScript; never load the pure engine or Node packages inside UXP.
4. Test invalid timing/requests, changed projects, duplicate runs, transaction errors,
   occupied destinations, unknown import outcomes and trim mismatch.
5. Verify in the real host and record supported behavior separately from remaining
   integration checks; publish the result on the existing Graphics PR.

## Completion record

Steps 1–5 are complete. The final production panel replay passed in Premiere 26.5.2 on
2026-10-08 (Asia/Seoul), using Basic Lower Third and Gaming Lower Third Left. Settings,
insertion, trim/readback, original-template display and property inspection passed;
the Basic receipt was exported through the panel. No production-code correction was
needed. See the verification report for exact evidence and remaining full-renderer limits.
