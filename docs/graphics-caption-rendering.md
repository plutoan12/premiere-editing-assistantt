# Caption rendering follow-up — 2026-10-08

The user requested the next step after the original-template preview passed live
verification: apply caption text, styling and placement in Premiere. The current
preview remains usable; its `graphicsApplied:false` result is still accurate.

Latest environment update: the user subsequently approved Premiere Beta installation.
**27.1.0.7** is now installed alongside 26.5.2.5. AE title/subtitle inspection succeeds,
but text transactions cause an unsupported MogrtText encoding error on readback.
**Panel writes are disabled**; original previews and typed text inspection remain usable.
Basic Lower Third still returns null source-text values. See the
[beta text verification record](graphics-engine-verification.md#beta-text-verification-and-write-gate--2026-10-08).
The compatibility investigation below describes the earlier 26.5.2 environment.

## Confirmed compatibility boundary

- The installed application is Premiere Pro **26.5.2**. Its bundle version was checked
  again during this investigation.
- In the preceding live run, Basic Lower Third's two source-text values and Gaming
  Lower Third Left's title/subtitle values were unavailable to the UXP inspector.
- Adobe's official type changelog introduces `MogrtText` and `MogrtComment` under
  **27.0.0-beta.22**, dated 2026-09-14. The official sample groups MOGRT text inspection
  under 27.0.0. Those newer examples cannot establish support in the installed 26.5.2.
- The newer `MogrtText` declaration includes text/font setters, with template-author
  editability checks. `setText` collapses mixed text runs to one run, so it cannot alone
  preserve the engine's per-span emphasis. A font setter alone also does not implement
  measured wrapping, outlines, shadows or safe-area placement.

These findings establish the documented API version gap. They are not a claim that
every possible legacy or alternate Premiere integration is impossible. No 27.x host
test, upgrade, dependency installation or new caption write was performed here.

## Selected route: editable MOGRT text

The user selected **route 2** on 2026-10-08. The panel now includes a capability-gated,
uniform text/font editing path intended to preserve MOGRT editability. The 26.5.2 host
cannot verify this newer API. Subsequent live 27.1 testing established readable AE text
but failed write readback, so `MOGRT_TEXT_WRITE_VERIFIED` keeps production writes off.

| Route | User-visible result | Work still required |
| --- | --- | --- |
| Transparent caption graphics on 26.5.2 | Text/style/placement rendered into a separate image clip; text changes regenerate the asset | Real font measurement and rasterization, alpha output, import/timing verification; explicitly identify the asset as a rendered caption |
| Editable MOGRT text | Keep text and supported font controls editable inside the template | A host exposing the newer API, template-specific bindings and editability checks, full readback/visual tests; separate handling for unsupported style/emphasis/placement |

The subsequent beta installation was separately authorized by the user.
The panel must not claim full-plan support merely because a newer text constructor
exists. Core and the pure GraphicsPlan contracts remain unchanged.

### Implemented boundary

- Inspect the exact single-item sequence from a successful preview receipt and offer
  only typed, uniform, non-time-varying text parameters. Binding uses component index,
  match name and parameter index/name; duplicate translated names are not guessed.
- Keep live inspection state in memory. Before editing, recheck project, sequence,
  asset identity, clip range, component binding and original text/font state. Retain
  the actual clip/component/parameter objects and require the same live references:
  an asset ID alone cannot distinguish a replacement timeline occurrence. Hosts that
  return fresh wrappers are blocked with `TEXT_TARGET_IDENTITY_CHANGED`; stable wrapper
  identity must be established on each supported host/template, never presumed from
  matching names, times or values. Stable wrappers were observed for Basic Lower Third
  on 27.1.0.7. A null project item is allowed, with live instance checks still required.
- Check template-author font restrictions on the original value. Construct a detached
  text value, preserving all seven exposed text/font fields, then commit one locked
  transaction and compare every field after reading it back from the host.
- Once a transaction is attempted, the inspection is consumed. Uncertain writes return
  `needs-review`; the panel disables further edits for that preview. It never retries or
  claims automatic rollback. There is no automatic project save.
- A GraphicsPlan can produce an `editable-text-draft` with exact preview identity/timing
  and caption text. The user selects the live target. Font names/sizes remain explicit;
  engine output pixels are not treated as proven template font units.
- `text-updated` is only a value-readback result. All receipts retain
  `graphicsApplied:false`: layout, color, outline, shadow, emphasis, placement and other
  template properties still require separate work. Existing font flags are preserved;
  mixed text runs are rejected to avoid `setText` flattening them.

Conflict detection is optimistic because SDK getters are asynchronous. It is not an
atomic compare-and-swap guarantee against simultaneous manual/other-plugin edits.
Host object semantics, author restrictions, font substitutions, native UI and visual
appearance require the 27.x smoke procedure in the panel README before release use.
The low-level write function remains experimental for isolated diagnostics; the panel
checks the release gate in both button state and the event handler. Re-enable it only
after a supported write path passes real-host readback, recovery and visual checks.

## Primary evidence

- [Adobe type changelog at the inspected commit](https://github.com/adobe/premierepro-types/blob/c8f108941197c1d987f08b9916c0d18a2e252699/CHANGELOG.md)
- [Adobe MogrtText / ComponentParam declarations at the same commit](https://github.com/adobe/premierepro-types/blob/c8f108941197c1d987f08b9916c0d18a2e252699/src/premierepro.d.ts)
- [Adobe sample: 27.0.0 MOGRT text handlers](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/main/sample-panels/premiere-api/index.ts)
- [Existing 26.5.2 host receipts](evidence/2026-10-08-graphics-host-smoke.json)
