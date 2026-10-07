# Editable MOGRT text — 2026-10-08

The user selected editable MOGRTs over raster captions. Extend the verified preview
panel with a bounded text-edit step using Adobe's 27.0 beta `MogrtText` API.

1. Inspect a successful, single-item preview. Detect the API and read typed text
   values, font restrictions and uniform styling. Keep live bindings in memory;
   never infer a text parameter from its translated name alone.
2. Edit one explicitly selected text parameter. Check the active project, sequence,
   item identity/range, component/parameter binding and original value again.
   Reject mixed styling and time-varying parameters. Preserve all uniform font
   flags, enforce author restrictions, create actions under locked access, and
   verify every text/font field after commit. No automatic retry after an uncertain
   write. An edit receipt is not full GraphicsPlan application.
3. Add panel text/font controls and a GraphicsPlan text draft converter. Leave font
   units/mapping explicit; do not equate engine pixel sizes with template units.
4. Test unsupported hosts, stale bindings, restrictions, failures and readback;
   run the full repository suite, relevant typechecks, build, and code review.
5. Publish on existing PR #15. Record 27.x host testing as pending: this machine has
   only 26.5.2. Do not install or upgrade Premiere as part of this code change.

Color, outlines, shadows, per-span emphasis, measured layout and auto-placement
remain separate template-specific work. Preserve the full-plan capability gate.

Implementation status: steps 1–4 complete in code and automated verification (176
tests; relevant typechecks/build; reviewed). Live text editing remains experimental
until the 27.x smoke checks, including stable wrapper identity, pass. Publication
continues on PR #15 without a merge or application installation.
