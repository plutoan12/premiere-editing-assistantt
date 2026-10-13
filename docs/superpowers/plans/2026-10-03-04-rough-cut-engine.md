# Rough Cut Engine Implementation Plan

**Goal:** Generate reviewable editorial proposals, never autonomous irreversible edits.

## Tasks
1. Silence intervals from transcript/audio evidence.
2. NG candidate rules using explicit markers/transcript repetitions where available.
3. Duplicate-take candidate clustering.
4. Selects scoring with deterministic filters first, optional semantic model second.
5. Transcript edit representation: selected source ranges + rationale.
6. SequencePlan builder with exact source/destination times.
7. Constraint validator: max duration, minimum handles, forbidden gaps/overlaps.
8. Prompts: selects-v1 and structure-v1 with structured output schemas.
9. Comparison/evaluation fixtures for interview, multicam talk, short-form.
10. Public API and CI.

**Tests:** repeated sentence, silence inside meaningful pause, contradictory AI range, hallucinated clip ID, source range outside media, user-locked segment.

**Completion:** every cut references real media/source time; invalid model suggestions are rejected before becoming SequencePlan.
