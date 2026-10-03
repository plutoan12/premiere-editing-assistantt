# Audio Engine Implementation Plan

**Goal:** Produce non-destructive, reproducible audio edit decisions.

## Tasks
1. Dialogue level/peak measurement interface.
2. Noise/cleanup analysis recommendations; keep DSP/provider behind interface.
3. BGM ducking envelope generation from dialogue ranges.
4. Beat/onset marker extraction interface.
5. Integrated loudness/true-peak measurement and target policy.
6. AudioDecision builder.
7. Guardrails against clipping and extreme gain changes.
8. Public API + synthetic audio fixtures + CI.

**Tests:** silence, clipped source, dialogue overlaps, music-only clip, short transient, target loudness already satisfied.

**Completion:** identical measurements/policy produce identical decisions; no destructive audio rendering occurs in engine.
