# Zenvi Link for After Effects

The `ae_*` tools Zenvi Link serves inside After Effects (SPEC §3.4): what
each one does, the taste it applies when an argument is left out, what is
known not to work, and how a person with After Effects verifies it.

- Catalog (names, schemas, descriptions): `src/catalog/aftereffects.ts`,
  generated into `extension/catalog/aftereffects.json`.
- Implementations (ExtendScript, ES3): `extension/host/aeft/*.jsx`, bundled
  after `common/*` into `host/aeft.jsx`.
- Defaults: `src/taste.ts` (TASTE.md as data), injected as `ZenviLink.TASTE`.
- Tests: `src/host/*.ae.test.ts` and `src/send-to-zenvi.ae.test.ts` run the real
  host script against the mock DOM in `src/testing/ae-mock.ts`.

Supported: After Effects 18 (2021) and later, as the manifest says. Some
features need a newer version:

| Feature | Needs | Before that |
| --- | --- | --- |
| Layer ids (a bare number as `layer`) | 22.0 (2022) | refused `UNSUPPORTED`; use `{"index": n}` or the name |
| "High Quality" ProRes 422 / 4444 templates | 22.0 | Lossless (QuickTime Animation) fallbacks |
| Track matte from any layer (`setTrackMatte`) | 23.0 (2023) | the matte must be the layer directly above |
| H.264 from the render queue | 23.0 | ProRes 422, then Lossless, with a warning |
| Installed-font check (`app.fonts`) | 24.0 (2024) | the font is set and read back; one that does not take is skipped |

Nothing here has been run inside After Effects yet (it is not installed where
this was built). See [Known limits](#known-limits-and-unverified-areas) and
the [manual test plan](#manual-test-plan-after-effects-20242026).

## Conventions

- **Comps**: `comp` is an item id (`comp_id` in receipts) or an exact name;
  left out, the active comp (refused `NO_ACTIVE_COMP` when there is none).
- **Layers**: `layer` is a layer id (a bare number, AE 22+), `{"index": n}`
  (1 = top) or the exact name. Ambiguous names are refused with the indexes.
- **Times** are comp seconds, snapped to the comp's frame grid; a receipt
  warning says when a time moved.
- **Property paths**: display or match names joined by `/`
  (`"Transform/Position"`, `"ADBE Effect Parade/Gaussian Blur/Blurriness"`).
  `Transform`, `Text` and `Effects` may be left out (`"Position"`,
  `"Source Text"`, `"Gaussian Blur/Blurriness"`); names match exactly, then
  case-insensitively; digits pick by index. A missing name is refused with the
  names that do exist at that level.
- **Values** are in the property's own units: numbers, `[x, y]` /
  `[x, y, z]` (z kept when left out), colours as `#RRGGBB` or `[r, g, b(, a)]`
  0–1, one number for uniform Scale, text for Source Text, `{vertices,
  in_tangents?, out_tangents?, closed?}` for paths. Ranges are checked first.
- **One call = one undo step.** Every mutating tool runs inside exactly one
  `app.beginUndoGroup("Zenvi: <title>")`. Arguments are validated before
  anything changes, so a refused call leaves the history untouched
  (`undoSteps: 0`). A call that fails after it started changing things says so
  in `warnings` ("Edit > Undo "Zenvi: …" reverts what it did"). Exceptions:
  `ae_save_project` and `ae_undo` report `undoSteps: 0`, and `ae_undo` runs Undo
  between two empty groups, because Undo must not run inside an open one.
- **Receipts** follow SPEC §3.3: `status` ok / applied / unchanged / refused /
  error, `summary`, `data` (ids from `layerRef`: `layer_id`, `comp_id`,
  `layer_index`, `name`, `type`), `warnings`, `undoSteps`, and `error.code` on
  failures.

## Tools

Bold arguments are required; `=` gives the default the host server fills in
(the scripts use the same TASTE fallbacks when called directly).

| Tool | Title | Kind | Arguments |
| --- | --- | --- | --- |
| `ae_get_state` | After Effects state | read | — |
| `ae_list_items` | List project items | read | type, name_contains, limit=200 |
| `ae_get_comp` | Inspect comp | read | comp, max_layers=200 |
| `ae_get_layer` | Inspect layer | read | comp, **layer**, time, max_keys=100 |
| `ae_capture_frame` | Capture comp frame | read | comp, time, max_width=1280 |
| `ae_create_comp` | Create comp | write | name="Zenvi Comp", preset, width, height, fps=30, duration=10, background, pixel_aspect=1, folder, open=true |
| `ae_set_comp` | Change comp settings | write | comp, name, duration, fps, width, height, background, work_area, motion_blur, shutter_angle, shutter_phase, frame_blending, open |
| `ae_import_files` | Import files | write | **paths**, folder="Zenvi Imports", sequence=false, dedupe=true |
| `ae_add_layer` | Add layer | write | comp, **kind**, item, path, name, color, width, height, shape="rect", size, stroke, stroke_width, roundness=0, light_type="point", start, in_point, out_point, position, scale, rotation, opacity, parent, blend_mode, three_d, label |
| `ae_add_text` | Add text | write | comp, **text**, subtitle, name, style, placement="center", font, size, fill, stroke, stroke_width, tracking, leading, justification, box, auto_break=true, shadow, start, duration, animation |
| `ae_set_text` | Change text | write | comp, **layer**, text, font, size, fill, stroke, stroke_width, tracking, leading, justification, box, time |
| `ae_set_layer` | Change layer | write | comp, **layer**, name, comment, start, in_point, out_point, stretch, enabled, audio_enabled, solo, locked, shy, motion_blur, three_d, adjustment, guide, collapse, blend_mode, track_matte, parent, label, quality |
| `ae_arrange_layers` | Arrange layers | write, destructive | comp, **layer**, **action**, to, time, name |
| `ae_set_property` | Set property | write | comp, **layer**, **property**, **value**, time |
| `ae_animate` | Animate property | write | comp, **layer**, **property**, **keyframes**, easing="smooth", replace=false, spatial="auto-bezier", overshoot=0 |
| `ae_apply_motion_preset` | Apply motion preset | write | comp, **layer**, **preset**, start, duration, intensity=0.5, direction, stagger |
| `ae_add_expression` | Set expression | write | comp, **layer**, **property**, **expression**, enabled=true |
| `ae_apply_effect` | Apply effect | write | comp, **layer**, **effect**, name, params, keyframes, easing="smooth" |
| `ae_set_effect` | Change effect | write, destructive | comp, **layer**, **effect**, params, enabled, name, remove=false |
| `ae_list_effects` | List installed effects | read | search, category, limit=100 |
| `ae_apply_look` | Apply colour look | write | comp, **look**, strength=0.6, layer |
| `ae_add_mask` | Add mask | write | comp, **layer**, shape="rect", bounds, path, name, mode="add", inverted=false, feather=0, expansion=0, opacity=100, animate |
| `ae_precompose` | Precompose layers | write | comp, **layers**, name, move_all_attributes=true, open=false |
| `ae_add_marker` | Add marker | write | comp, layer, time, comment="", duration=0, chapter, url, label, protected_region |
| `ae_render` | Render comp | write | comp, output, preset="h264", template, render_settings="Best Settings", work_area_only=false, mode="render_now", overwrite=false |
| `ae_save_project` | Save project | write | path, overwrite=false |
| `ae_undo` | Undo Zenvi steps | write, destructive | steps=1 |
| `ae_run_jsx_file` | Run JSX file | write, destructive | **path** |
| `ae_run_script` | Run ExtendScript | write, destructive | **code** |
| `ae_render_for_zenvi` | Render for Zenvi | write | comp, alpha=false, output, work_area_only=false, template |

Notes per tool, beyond the catalog descriptions:

- `ae_capture_frame`: `saveFrameToPng` returns before the PNG is written (the
  file first appears empty), so the tool waits, up to 20 s, until the file ends
  with its IEND chunk, then reads the size from the PNG header. Comps wider
  than `max_width` render at a resolution factor (1920 → 960, 3840 → 1280) that
  is restored afterwards; a comp shown at half resolution is captured at full
  resolution. The change and its restore run inside one undo group of their
  own, so if After Effects records resolution changes they cost at most one
  (no-op) undo step. The comp's end is clamped to its last frame.
  `data.image_path` becomes the image block (the server deletes the temp file).
- `ae_import_files`: every path must exist and be importable before anything
  is imported; files already in the project are reused (`reused: true`), so a
  repeat call is `unchanged`.
- `ae_add_layer`: new layers go on top. Footage by `path` is imported into
  "Zenvi Imports" once. Shapes are one group with the primitive, then a stroke
  above the fill (the stroke draws on top).
- `ae_set_layer`: refused on a locked layer unless the same call passes
  `locked: false` (applied first); `locked: true` is applied last.
- `ae_arrange_layers`: `split` duplicates the layer, ends the original at
  `time` and starts the copy there, like Edit > Split Layer.
- `ae_animate`: see [Easing](#easing). Keyframes inside the new span are
  replaced, keyframes outside it kept (`replace: true` clears them all).
  Linear easing on anything but opacity warns (TASTE: linear only for opacity
  crossfades, loops and tickers). Source Text keys hold.
- `ae_add_expression`: After Effects checks an expression when it is set; one
  that reports an error is removed again (the previous expression restored)
  and the call is refused with After Effects' message.
- `ae_apply_effect`: exact match name, exact display name (any case), then a
  unique display-name prefix, then a unique substring; ambiguous names are
  refused with the candidates. Parameters can only be checked once the effect
  exists, so a bad parameter takes the effect off again before refusing.
- `ae_render` renders only its own queue item: other queued items are
  unchecked during the render and checked again afterwards.
- `ae_undo`: After Effects has no API for its undo history, so the receipt
  names the Zenvi steps it recorded this session. If someone changed the
  project by hand after the last Zenvi call, Undo undoes that first.
- `ae_run_jsx_file` / `ae_run_script` run arbitrary code inside one undo step.
  `ae_run_script` returns JSON of the last expression; values that cannot be
  serialized (host objects, cycles) come back as `String(value)`.

## Taste built in

Every default comes from TASTE.md (`src/taste.ts`); a lazy call already looks
designed.

### Easing

Names: `smooth` (default) `(0.33, 0, 0.2, 1)`, `out`/`entrance`
`(0.16, 1, 0.3, 1)`, `in`/`exit` `(0.7, 0, 0.84, 0)`, `in-out`
`(0.65, 0, 0.35, 1)`, `snap` `(0.2, 0, 0, 1)`, `linear`, `hold`, or a custom
`{x1, y1, x2, y2}`.

Each Bezier segment from key A to key B, with value change dv over dt, is set
on the keys exactly as TASTE §2 says:

- A's outgoing ease: influence = x1 × 100 %, speed = (y1 / x1) × dv / dt
- B's incoming ease: influence = (1 − x2) × 100 %, speed = ((1 − y2) / (1 − x2)) × dv / dt
- speed 0 when x1 or 1 − x2 is 0; influence clamped to [0.1, 100]
- spatial properties (Position, Anchor Point) use the path length as dv and
  one ease; other multi-dimensional properties (Scale) one ease per dimension
  with each dimension's own dv (so speeds can be negative); colours use the
  distance in colour space.

Example: Position moving 60 px in 0.6 s with `out` gives A an outgoing speed
of 625 px/s at 16 % influence and B an incoming speed of 0 at 70 %. Keys get
Bezier interpolation, temporal continuity and auto-Bezier off; spatial keys get
auto-Bezier paths (`spatial: "linear"`: zero tangents). `overshoot` (0–0.06,
playful brands only) adds an editable keyframe `overshoot` past the target at
min(0.25 s, 40 % of the segment) before the end, easing back in-out.

### Motion presets (`ae_apply_motion_preset`)

All presets are keyframes or text animators a person can retime; only
`drift` is an expression. Keyframes already in the preset's time range on the
same properties are replaced; re-applying a text preset replaces its animator.
`intensity` maps 0 / 0.5 / 1 to the low end / TASTE default / high end of the
range below. Entrances start at the layer's in point, exits end at its out
point, holds run from the in point to the out point.

| Preset | What it animates | Duration | Easing | Distance / amount (intensity 0 · 0.5 · 1) |
| --- | --- | --- | --- | --- |
| `fade-in` | Opacity 0 → rest | 0.6 s | out | — |
| `fade-out` | Opacity rest → 0 | 0.4 s | in | — |
| `slide-in` | Position from rest − travel, Opacity 0 → rest | 0.6 s | out | 3 · 4 · 6 % of the width; direction `up` |
| `slide-out` | Position to rest + travel, Opacity → 0 | 0.4 s | in | 3 · 4 · 6 %; direction `down` |
| `scale-pop` | Scale from a fraction of rest, Opacity 0 → rest | 0.27 s (8 frames at 30 fps) | snap (scale), out (opacity) | from 96 · 92 · 85 % |
| `blur-in` | "Zenvi Blur In" Gaussian Blur (Repeat Edge Pixels on) to 0, Opacity | 0.6 s | out | 1.5 · 3 · 6 % of the short side (32.4 px at 1080) |
| `whip-in` | Position from rest − travel, Opacity over the first 40 %; layer and comp motion blur on | 0.35 s | snap (position), out (opacity) | 15 · 25 · 50 % of the width; direction `right` |
| `typewriter` | "Zenvi Typewriter" animator: Opacity 0, Range Selector by characters excluding spaces, Square, Smoothness 0, Start 0 → 100 % | 0.04 s per character | linear (a ticker) | — |
| `word-cascade` | "Zenvi Word Cascade" animator: Opacity 0 and Position [0, d, 0], Range Selector by words, Ramp Up, Ease High 50, Ease Low 100, End = W, Offset −W → 100 % | 0.6 s per word, 0.06 s apart | Offset linear; the selector eases each word | d = 3 · 4 · 6 % of the width |
| `line-rise` | the same by lines ("Zenvi Line Rise") | 0.6 s per line, 0.12 s apart | as above | as above |
| `ken-burns` | Scale 100 → 100 + k, Position panned 0.4 × k × width (less than the overscan) | the layer's length | in-out | k = 3 · 4 · 6 %; direction `left` |
| `push-in` | Scale 100 → 100 + k | the layer's length | in-out | k = 3 · 4 · 6 % (TASTE: 104 %) |
| `drift` | an expression on Position marked `// Zenvi drift`: a slow sine float (0.12 Hz) that fades in over 1 s | — | — | amplitude 0.25 · 0.5 · 1 % of the width (9.6 px at 1920) |

`direction` is the direction of travel. Separated X/Y Position is handled (only
the moving axis is keyed). Presets need a footage, text, shape, solid or
precomp layer; text presets need a text layer. TASTE gives only one number for
scale-pop, blur-in, whip-in and drift; the ranges above are this tool's.

Text cascades use one Range Selector: each word or line takes `duration` to
arrive and they start `stagger` apart, so the selector window is
W = min(100, 100 × duration / (units × stagger)) % and the Offset runs over
duration × (100 + W) / W. With few units W reaches 100 % and the stagger widens
to duration / units (4 words: 0.15 s); the receipt warns and reports the real
`stagger`. A single word or line animates the animator's own Opacity and
Position instead.

### Text (`ae_add_text`)

Sizes are for a 1080-pixel short side and scale with the comp's short side
(a 9:16 1080×1920 comp uses the same sizes).

| Style | Size | Weight | Tracking (1/1000 em) | Leading | Default for placement |
| --- | --- | --- | --- | --- | --- |
| `headline` | 96 px | bold | −15 | 1.1 | — |
| `title` | 72 px | bold | −10 | 1.1 | `center` |
| `subtitle` | 44 px | regular | 0 | 1.3 | `top-left`, `top-center` |
| `lower-third` | 54 px name; `subtitle` becomes a 34 px role | bold / regular | 0 | 1.1 / 1.3 | `lower-third` |
| `caption` | 42 px | regular | 0 | 1.3 | `bottom-center` |

- ALL CAPS text gets +80 tracking (labels); headline and title in caps stay at 0.
- Fonts: the requested PostScript name, then Inter, SF Pro Display, Helvetica
  Neue, Arial (bold or regular). AE 24+ checks `app.fonts`; older versions set
  the font and read it back. A fallback warns; with none installed the text
  keeps After Effects' font and warns.
- New text starts from default character and paragraph styles (nothing left
  in the Character panel leaks in); fill is paper `#F7F7F5`.
- Lines over 32 characters are broken at balanced word boundaries without an
  orphan word (`auto_break: false` keeps the text as written; text with its own
  line breaks is kept).
- Too-wide text shrinks (to at most half size) to fit title-safe, with a warning.
- Placement keeps the block inside title-safe: a 10 % inset, and on 9:16
  (height ≥ 1.5 × width) the top 12 % and bottom 20 % too (1080×1920:
  x 108–972, y 230.4–1536). `center` centres the block in the safe area;
  `lower-third` puts the name's left edge at the title-safe x and its first
  baseline at 80 % of the height (70 % on 9:16), raised when the block would
  end below title-safe; `subtitle` sits 0.25 × the name size below.
  Anchors are at each line's alignment edge and vertical middle, so scale
  animations grow from there.
- Over footage or a precomp (`shadow` left out) both layers get "Zenvi
  Shadow": Drop Shadow, distance 0, softness 16 px at 1080p, 40 % black.
- Duration: to the comp's end; lower thirds 5 s. Shorter than the reading time
  (1.5 s + 0.3 s per word) warns.
- `animation` applies an entrance preset at the layer's start; the subtitle
  follows 0.12 s later.

### Looks (`ae_apply_look`)

One adjustment layer, "Zenvi Look (<look>)", spanning the comp and marked
`zenvi:look` in its comment, is reused when you try another look (its Zenvi
effects are replaced). With `layer`, that layer is graded instead. Changes are
TASTE deltas × `strength` (default 0.6; skin should stay natural):

| Look | Lumetri Color ("Zenvi Look") | Also |
| --- | --- | --- |
| `clean` | Contrast +5, Vibrance +5 | — |
| `warm-film` | Temperature +8, Tint +2, Faded Film +8, Saturation −6 (96.4 at 0.6) | — |
| `teal-orange` | Saturation +6 | Color Balance "Zenvi Split Tone": shadows R −20, G +6, B +20; highlights R +20, G +6, B −20; Preserve Luminosity on |
| `moody` | Exposure −0.3, Contrast +12, Saturation −15, Vignette Amount −0.8 | — |
| `bw-contrast` | Saturation 0 at any strength, Contrast +25 | — |

Lumetri parameters are found by their English names within their section
(`Basic Correction/Saturation` and `Creative/Saturation` are different
parameters). When none is found (a non-English After Effects) the look is
taken off again and refused. The split tone uses Color Balance because the
scripting values of Lumetri's tint wheels are not documented.

### Renders

| Preset | AE 2023+ | AE 2022 | AE 2021 and older | Codec label |
| --- | --- | --- | --- | --- |
| `h264` | "H.264 - Match Render Settings - 40 Mbps" (else 15 Mbps), `.mp4` | falls back to `prores-422` | falls back to `lossless` | `h264` |
| `prores-422` | "High Quality" | "High Quality" | falls back to `lossless` | `prores422` |
| `prores-4444` | "High Quality with Alpha" | "High Quality with Alpha" | falls back to `lossless-alpha` | `prores4444` |
| `lossless` | "Lossless" | "Lossless" | "Lossless" | `qtrle` |
| `lossless-alpha` | "Lossless with Alpha" | "Lossless with Alpha" | "Lossless with Alpha" | `qtrle` |

Fallbacks warn; the output extension follows the format (with a warning when
it changed). Render settings default to "Best Settings". `ae_render` writes to
`<project folder>/Renders/<comp>.<ext>` unless `output` is given (an untitled
project needs `output`) and refuses to overwrite unless `overwrite`.

`ae_render_for_zenvi` reports only codecs Zenvi links (SPEC §3.6: `h264`,
`prores4444`, `qtrle`; the desktop refuses others), so it has its own
fallbacks and never renders ProRes 422:

| Request | AE 2023+ | AE 2022 | AE 2021 and older |
| --- | --- | --- | --- |
| opaque (default) | H.264 (40 Mbps, else 15) | ProRes 4444 "High Quality with Alpha" | "Lossless" (QuickTime Animation), else "Lossless with Alpha" |
| `alpha: true` | ProRes 4444 "High Quality with Alpha" | ProRes 4444 | "Lossless with Alpha" (QuickTime Animation) |

Every fallback warns (an opaque request rendered with alpha keeps the comp's
transparent areas transparent in Zenvi). An explicit `template` must be an
H.264, ProRes 4444 or QuickTime Animation template; anything else is refused,
and so is a version with no linkable template at all. The render goes into
`<temp>/zenvi-link/renders/<comp>-<id>-<date>-<time>.<ext>`, removes its queue
item after a successful render (a failed one stays for inspection), and
returns `path`, `comp_id`, `comp_name`, `project`, `width`, `height`, `fps`,
`fps_rational` (`30000/1001` for 29.97), `duration`, `duration_frames`, `codec`,
`template`, `rendered_at` and a ready SPEC §3.6 `link`:

```json
{
  "version": 1,
  "kind": "aftereffects",
  "source": {"project_dir": null, "entry": null, "composition": "Promo", "composition_key": 12, "file": null, "line": null, "aep": "/Users/me/Work/promo.aep"},
  "props": {},
  "render": {"codec": "h264", "width": 1920, "height": 1080, "fps": {"num": 30, "den": 1}, "duration_frames": 300,
             "output": "/var/folders/…/zenvi-link/renders/Promo-12-20261004-210000.mp4", "rendered_at": "2026-10-04T21:00:00.000Z", "fingerprint": null},
  "state": "fresh",
  "error": null
}
```

### Send to Zenvi (panel)

`extension/panel/send-to-zenvi-aftereffects.js`: when the Zenvi desktop app is
running (`~/.openshot_qt/gui_mcp.json`, pid alive), the panel's *Send to
Zenvi* renders the active comp with `ae_render_for_zenvi` (30 min budget; H.264,
or ProRes 4444 / QuickTime Animation before After Effects 2023) and
calls the desktop's `import_linked_media_tool` with `{path, link, name}`. It
shows After Effects' or Zenvi's own message when either refuses, says so when
Zenvi is not running (before rendering), and reminds to save an untitled
project so Zenvi can re-render the clip.

## Correctness aids

```bash
npx vitest run --project adobe-link             # all package tests (mock DOM, ES3 realm)
npm run typecheck:jsx -w @zenvi/adobe-link      # aeft/*.jsx against types-for-adobe AfterEffects/26.0
npm run typecheck -w @zenvi/adobe-link
npx eslint packages/adobe-link
npm run gen:catalog -w @zenvi/adobe-link        # then commit extension/catalog/*.json
```

- The tests run the bundled host script in a Node `vm` realm stripped to
  ECMAScript 3 against `src/testing/ae-mock.ts`, which follows the Scripting
  Guide and enforces what trips real scripts up: ease arrays per dimension,
  influence 0.1–100, setValue on keyframed properties, separated dimensions,
  Range Selector values hidden by Units, Source Text only holding, fill reads
  without applyFill, fonts that do not take before AE 24, saveFrameToPng
  writing late, render-queue templates per version.
- `typecheck:jsx` checks the scripts with `checkJs` against types-for-adobe
  (`tsconfig.jsx-aeft.json`, with our own globals in `types/aeft-host.d.ts`;
  `scripts/typecheck-jsx.mjs` runs every `tsconfig.jsx*.json`), so a wrong DOM
  name (`comp.bgColour`,
  `layers.addSolidLayer`) or a misspelled `ZenviLink.ae` helper fails.
- A test checks that every literal TASTE path the scripts read exists, and
  that every tool called bare keeps undo groups balanced.

## Known limits and unverified areas

Verified only against the mock DOM and the typings. These need a real After
Effects (the manual plan covers them):

1. **saveFrameToPng** is undocumented by Adobe. Assumed: it renders at the
   comp's resolution factor (the tool reads the real size from the PNG either
   way). Unknown: whether changing `resolutionFactor` from a script adds an
   undo step (contained to at most one, see `ae_capture_frame`) or marks the
   project dirty.
2. **Range Selector timing** assumes After Effects' standard Ramp Up behaviour
   (units past End stay fully selected; Offset −W → 100 % reveals them in
   order). Per-unit timing is approximate; very short texts widen the stagger.
   Whether the animator's Position (`ADBE Text Position 3D`) is spatial is read
   at run time.
3. **Lumetri** parameters are matched by English names within sections (no
   documented match names); non-English After Effects refuses looks. Color
   Balance is matched by English names with assumed match names
   (`ADBE Color Balance 2-0001` …) as a fallback.
4. **Output module template names** are matched by English name; a localized
   After Effects may need `template`. `media_encoder` only queues in Adobe
   Media Encoder (it does not start the queue).
5. **Ease on linear sides**: setting a temporal ease is assumed to be able to
   turn a linear or hold side into Bezier, so mixed keys get their
   interpolation set again afterwards.
6. **Expression errors** are read from `expressionError` right after setting
   the expression; the mock only reports syntax errors.
7. **ae_undo** cannot read the undo history (no API) and uses command 16 when
   `findMenuCommandId("Undo")` finds nothing (the item is renamed after each
   action). Its journal resets when the host script reloads.
8. **Codec labels** come from template names ("High Quality with Alpha" and
   any name with 4444: `prores4444`; "Lossless", "Lossless with Alpha":
   `qtrle`, assumed to be QuickTime Animation as in a fresh install). A
   renamed or localized template may need `template`.
9. **Temp folders**: captures and renders go under ExtendScript's
   `Folder.temp`; the server deletes captures only inside the OS temp folder,
   assumed to be the same folder (true on macOS; check on Windows).
10. **Blocking renders**: `render_now` and `ae_render_for_zenvi` block After
    Effects until the render finishes (30 min budget per call).
11. **Exits and holds end with the comp**: a layer that runs past the comp's
    end exits (and Ken Burns / push-in end) at the comp's end, the last frame a
    viewer sees.

## Manual test plan (After Effects 2024–2026)

For a person with After Effects 2024 (24.x), 2025 (25.x) and 2026 (26.x),
on macOS and, if possible, Windows. Record pass/fail per step with a
screenshot; note the After Effects version.

**Setup**

1. In the repo: `npm ci`, then `npm run install:dev -w @zenvi/adobe-link`;
   restart After Effects. **Pass:** `~/.openshot_qt/link/aftereffects.json`
   appears; *Window → Extensions → Zenvi Link* shows "Running".
2. In the panel click *Copy MCP config* and run the copied
   `claude mcp add --transport http zenvi-aftereffects …` line. Start Claude
   Code. **Pass:** `claude mcp list` shows it connected; asking for
   `ae_get_state` returns the app version and open project.
3. Open the Zenvi desktop app with a project (for step 12).

**Scenario** (ask Claude to call each tool, or use `curl` from the README;
after each step check the After Effects UI and Edit > Undo)

4. `ae_create_comp {"name": "Zenvi Test"}`. **Pass:** a 1920×1080, 30 fps,
   10 s comp with background #0B0B0F opens; Edit shows *Undo Zenvi: Create comp*.
5. `ae_import_files {"paths": ["<a .mov on disk>"]}` then the same call again.
   **Pass:** one item in a "Zenvi Imports" folder; the second call is
   `unchanged`. Then `ae_add_layer {"kind": "footage", "item": <id>}`.
   **Pass:** the clip is the top layer.
6. Lower third: `ae_add_text {"text": "Jane Doe", "subtitle": "Director",
   "placement": "lower-third", "animation": "line-rise"}`. **Pass:** two text
   layers inside the title-safe guide (*View → Show Title/Action Safe*), the
   name left-aligned at x ≈ 192 with its baseline at y ≈ 864, the role 34 px
   below; Inter Bold if installed, otherwise SF Pro Display / Helvetica Neue
   (receipt says which); a "Zenvi Shadow" effect (footage is below); both end
   at 5 s; each has a "Zenvi Line Rise" animator with a Range Selector;
   scrubbing 0–0.6 s, the name rises about 77 px and fades in with an ease-out,
   the role 0.12 s later. Undo once: both layers go.
7. Multi-line rise: `ae_add_text {"text": "Line one\nLine two\nLine three",
   "animation": "line-rise"}`. **Pass:** lines arrive one after another about
   0.2 s apart (the receipt warns that three lines widen the stagger).
   `ae_apply_motion_preset {"layer": <id>, "preset": "word-cascade"}` on a
   12-word text: words 0.06 s apart.
8. Look: `ae_apply_look {"look": "warm-film"}`. **Pass:** a top adjustment
   layer "Zenvi Look (warm-film)" with Lumetri Color: Temperature 4.8, Tint 1.2,
   Faded Film 4.8, and the Basic Correction Saturation (not Creative) at 96.4.
   Then `ae_apply_look {"look": "teal-orange"}`. **Pass:** the same layer, now
   with Lumetri plus Color Balance "Zenvi Split Tone".
9. Eyes: `ae_capture_frame {"time": 0.6}`. **Pass:** Claude shows a 960×540
   image matching the viewer; the comp's Resolution menu is as before. Note
   whether Edit > Undo gained an entry and whether the project title shows
   unsaved changes (unverified area 1).
10. Easing: `ae_animate {"layer": "Jane Doe", "property": "Position",
    "keyframes": [{"time": 1, "value": [400, 900]}, {"time": 1.6, "value": [400, 864]}],
    "easing": "out"}`. **Pass:** *Animation → Keyframe Velocity* shows the first
    key's outgoing speed 375 px/s at 16 % influence (36 px in 0.6 s is 60 px/s,
    × 1/0.16) and the second key's incoming 0 px/s at 70 %; the speed graph
    starts fast and settles slowly. Expression check:
    `ae_add_expression {"layer": "Jane Doe", "property": "Rotation",
    "expression": "time *"}` is refused with After Effects' error text and no
    expression remains; `"wiggle(1, 5)"` applies.
11. Render: `ae_save_project {"path": "<folder>/zenvi-test.aep"}`, then
    `ae_render {}`. **Pass:** `<folder>/Renders/Zenvi Test.mp4` (2023+) plays;
    an item already in the render queue was not rendered and is still checked.
12. Send to Zenvi: click the panel's *Send to Zenvi*. **Pass:** the panel shows
    `Sent "Zenvi Test" to Zenvi (10 s, h264)` and Zenvi shows a linked clip
    whose link info names `aftereffects`, the comp and the .aep. Repeat with a
    comp longer than two minutes of render time (the panel must wait). With
    Zenvi closed, the panel says Zenvi is not running and renders nothing.
    `ae_render_for_zenvi {"alpha": true}` gives a ProRes 4444 .mov with alpha.
13. Undo: `ae_undo {"steps": 2}`. **Pass:** the last two Zenvi steps are undone
    (check the comp); the receipt names them.
14. Refusal leaves history alone: `ae_add_layer {"kind": "footage"}`.
    **Pass:** refused; Edit > Undo still names the previous step.
15. Versions: on AE 2024+ a missing `font` falls back with a warning; on AE
    2022 (if available) `ae_render` falls back to ProRes 422 with a warning and
    layer ids still work. On a non-English After Effects, `ae_apply_look` is
    refused with the match-name hint and `ae_render` may need `template`.
16. Windows: repeat 4–12 and check capture and render paths (no mixed
    separators) and that captured PNGs are deleted after they are attached.
