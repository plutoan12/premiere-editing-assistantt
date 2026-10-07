# PEA Graphics Preview (development)

Premiere Pro 26.2+ UXP panel. The supported operation is **original-template preview**:
create a new sequence, configure its frame size/rate, insert a chosen MOGRT, trim its
end, and read the actual start/end ticks back. Existing sequence contents are not used
as the insertion target. The panel does not save the project automatically.

The original preview does not apply caption text, styling, emphasis, planned placement
or template-property overrides. A separate **text inspection** step is available for
hosts exposing `MogrtText` (documented in the 27.0 beta API). Experimental text writes
are disabled after a real-host readback failure on 27.1.0.7. Every receipt still has
`graphicsApplied: false`; text editing is not full-plan rendering.
The panel must not be described as the full GraphicsPlan renderer. On local Premiere
26.5.2, Basic Lower Third exposed two text components after loading, but their source-text
values were unavailable to this inspector. An AE Gaming Lower Third also exposed
unavailable title/subtitle values after its Capsule component finished loading.

The original preview panel at `ede9a2e` was verified in Premiere 26.5.2 with both templates: sequence settings,
insertion, exact start/end readback, property inspection and visible original graphics.
Receipt export was also verified. See the [host verification record](../../docs/graphics-engine-verification.md#final-production-panel-replay--2026-10-08).
Premiere Beta 27.1.0.7 reads the AE template's title and subtitle, but all tested writes
caused an unsupported MogrtText encoding error on readback. Basic Lower Third's text
values remain unavailable. See the
[beta text verification record](../../docs/graphics-engine-verification.md#beta-text-verification-and-write-gate--2026-10-08).

## Build and load

From the repository root (after the normal workspace dependency setup):

```sh
node apps/premiere-graphics-panel/build.cjs
```

This uses the existing TypeScript dependency, with no extra bundler or Adobe SDK package.
Load `dist/manifest.json` from this panel directory using Adobe UXP Developer Tools.
The output is a development folder, not a signed CCX installer. The only requested
permission is file access through pickers; no network permissions are requested.

1. Open a disposable test project in Premiere.
2. In PEA Graphics Preview, choose a `.mogrt` using **MOGRT 선택**.
3. Choose **새 시퀀스에서 미리보기**. The default example uses 1920×1080 at
   30000/1001 fps, starts at frame 60 and lasts 30 frames.
4. Verify the picture and timing in the new `PEA Preview · …` sequence. Use
   **템플릿 속성 확인** after AE loading settles, and **결과 저장** for the receipt.
5. A `needs-review` result can mean partial edits remain. Inspect its sequence ID and
   Premiere history before starting another preview. There is no automatic retry or
   rollback; MOGRT import and subsequent transactions are separate undo steps.

The button is disabled after a result to prevent accidental repeated insertion. Selecting
another template or plan explicitly starts a new preview. A file's template version cannot
be inferred from its filename: select the correct asset for the plan's template/version.

## Connecting a GraphicsPlan

The public adapter turns a validated engine decision into the intentionally limited wire
request that **미리보기 계획 불러오기** accepts:

```ts
import { createMogrtPreviewRequest } from '@pea/premiere-adapter';
const request = createMogrtPreviewRequest(plan, 'caption-a', exactVersionBinding);
// Serialize request as JSON and load it in the panel, then select the matching MOGRT.
```

`exactVersionBinding` uses the existing compiler binding contract: templateId,
templateVersion, absolute templatePath and propertyMap. The preview does not consume
propertyMap as edits. After a plan is loaded, template selection is reset. The panel
captures the project identity when the template is selected and rejects a project switch.

The request contains canonical decimal ticks (`startTicks`, `durationTicks`, `frameTicks`).
Conversion uses 254016000000 ticks/second and exact bigint division. The host boundary
rejects fractional frames, unsupported rational conversions, zero duration and values
outside signed 64-bit ticks, even though the engine can represent larger bigint values.
Frame dimensions are integral pixels and ticks per frame must fit a safe JS integer for
Adobe's FrameRate setter. Timecode display/drop-frame labels are not configured; physical
frame timing is preserved and checked against the created sequence's timebase.

## API references

- [SequenceEditor: MOGRT insertion](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor)
- [TickTime: string ticks](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/ticktime)
- [SequenceSettings](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequencesettings)
- [Project transactions](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project)

## Text inspection (27.0 beta API; writes blocked)

1. Make a preview in a disposable project. Choose **템플릿 문구 확인** after the
   template finishes loading. On hosts without `MogrtText`, this control is disabled.
2. Select the exact title/subtitle in **템플릿의 문구**. Selection is explicit even if
   multiple parameters have identical names. Only uniform, non-animated text is offered;
   mixed styling is excluded because Adobe's `setText` collapses multiple style runs.
3. Inspect the current text and font metadata. Text/font inputs and **선택한 문구에 적용**
   remain disabled by `MOGRT_TEXT_WRITE_VERIFIED = false`, independently of API presence.

The following describes the experimental path for future isolated host verification,
not an available production workflow. Do not enable the release gate solely because
the constructor exists or a transaction returns true:

1. Enter the new text. Leave font fields blank to retain their current values. Author-
   locked font fields stay disabled. Font names and sizes use the host/template's own
   values; they are not a verified mapping from the engine's pixel measurements.
2. Choose **선택한 문구에 적용**. A single transaction attempts the selected
   parameter, and all exposed text/font values are read back. The result is appended to
   `textEdits`. Read parameters again before another edit; a `needs-review` result
   disables further text edits on this preview, requiring manual host review.
3. Check the picture, line breaks, font availability and editability in Premiere's own
   Properties panel. A successful value readback alone does not prove visual fidelity.

For engine caption text, save and load this JSON through the same plan picker:

```ts
import { createMogrtTextDraft } from '@pea/premiere-adapter';
const draft = createMogrtTextDraft(plan, 'caption-a', exactVersionBinding);
// JSON.stringify(draft), load it, choose the matching template, make a preview,
// inspect text and explicitly select its live parameter before applying.
```

The converter carries original caption text, not measured line breaks or font styling.
It does not infer a template's caption binding or font units. Color, outline, shadow,
emphasis and placement are not applied. The `compilePremiereGraphicsPlan` capability
gate remains unchanged: the panel does not declare `captionLayout` or `emphasis` support.

### Required 27.x smoke checks

Record the exact Premiere build, template/version and exported receipt. Repeat for a
Premiere-authored and AE-authored template that expose typed text. Verify Korean,
multiline and emoji text; text-only edits preserve font fields; unlocked font edits
read back; and the result remains editable in Premiere. Visually check font substitution,
glyph coverage, wrapping and timing. Check undo once and inspect again before another
edit. For locked fonts, mixed styling and time-varying text, verify the operation is
unavailable. Manually change the original text after inspection and verify stale edits
are blocked. Replace a clip/component/parameter with an identical-looking instance and
verify that its old inspection cannot edit the replacement. The adapter requires stable
live object references: if the SDK returns fresh wrappers, it blocks with
`TEXT_TARGET_IDENTITY_CHANGED`. Establish this identity behavior on the exact host build;
do not substitute project-asset identity for clip-instance identity. Keep any uncertain
write for review rather than retrying it. The 27.1.0.7 run reached native plan selection,
preview, typed AE inspection and failed text write/readback. Korean and ASCII probes
both failed. Two manual Undo checks restored original title/font/size; the last ASCII
probe still needs Undo after Mac unlock. Font writes, edited appearance, persistence
and the remaining negative host checks have not passed. No successful text write is claimed.

API evidence: [Adobe's MogrtText/ComponentParam declarations](https://github.com/adobe/premierepro-types/blob/c8f108941197c1d987f08b9916c0d18a2e252699/src/premierepro.d.ts),
[version boundary and implementation notes](../../docs/graphics-caption-rendering.md).
