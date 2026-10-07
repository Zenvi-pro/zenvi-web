# Zenvi Link for Premiere Pro

Zenvi Link exposes Premiere Pro as a loopback MCP host with 25 `premiere_*`
tools (SPEC §3.4). The tools are ExtendScript in `extension/host/ppro/*.jsx`,
defined once in `src/catalog/premiere.ts`. They use Premiere's documented
ExtendScript DOM where it can do the job, and the undocumented QE DOM where
Adobe offers nothing else: razor, effects, transitions, speed, frame export,
sequences from presets, and the undo-stack position.

- **Versions:** the extension loads in Premiere Pro 2021 (15.0) and later
  (manifest `PPRO [15.0,99.9]`). Clip `move` and enable/disable need 15.4.
- **Not verified in Premiere.** Premiere Pro is not installed where this was
  built. Every tool is tested against a mock DOM (`src/testing/premiere-mock.ts`,
  `ppro-qe.ts`), parsed as ES3, and type-checked against `types-for-adobe`
  Premiere/24.0. The manual test plan at the end is what a person with
  Premiere has to run.

## Conventions

- **IDs.** Project items and clips (track items) are addressed by `nodeId`.
  Sequences use `sequence_id` (the DOM `sequenceID`) or an exact name. Tracks
  are `{kind: "video" | "audio", index}`, 0-based like the DOM (V1 = 0, A1 = 0).
  A clip is looked up in `sequence` when given; otherwise the active sequence
  is searched first, then every sequence.
- **Times** are seconds, snapped to the sequence frame grid; `warnings` say
  when a time moved.
  - Keyframe times in `premiere_animate` count from the clip's first frame.
    Premiere stores keyframes in source time, so the clip's in point is added.
  - Clip markers are placed at the matching source time.
- **Units.**
  - Position is in sequence pixels from the top-left. Premiere stores it
    normalised to 0-1.
  - Anchor is a fraction of the clip frame.
  - Scale and opacity are percent; rotation is degrees.
  - Volume is in dB. Premiere's Level is linear gain normalised so that
    +15 dB = 1, so 0 dB = 0.1778.
- **Receipts** follow contract 3: `ok` for read-only tools, `applied`,
  `unchanged`, `refused` (nothing changed) or `error`.
- **Validation.** Arguments are checked, and lookups refused, before
  anything changes.
- **Undo.** Premiere's scripting API cannot group undo, so every change is
  its own undo step. `undoSteps` is how far Premiere's undo stack moved
  during the call (QE `qe.project.undoStackIndex()`). When this build does
  not report the stack, it is the number of changes the tool made. It is
  `null` when neither is known. If a call fails after it started changing
  things, the receipt says so in `warnings`.

## Tools

| Tool | What it does | Defaults and notes |
| --- | --- | --- |
| `premiere_get_state` | App version, project, every sequence, active sequence with playhead, in/out, selection | Read-only |
| `premiere_list_items` | Bins and items as a flat list: nodeId, kind (bin/sequence/media/clip), bin path, media path, in/out, offline | `kind` any, `limit` 200; start from a `bin` path or nodeId |
| `premiere_get_sequence` | Tracks (muted/locked/targeted), clips (times, source in/out, media, speed, effects, position/scale/rotation/opacity/blend or volume dB, animated properties), transitions, markers | `include_properties` true, `max_clips` 500 |
| `premiere_capture_frame` | One frame as PNG (returned as an image) via QE `exportFramePNG` | Time defaults to the playhead; a sequence QE cannot reach is opened first. Waits up to 20 s for a whole PNG in the Zenvi temp folder |
| `premiere_import_files` | Files into a bin, returning nodeIds | Bin "Zenvi Imports" (created); `dedupe` returns existing items; missing files refused first |
| `premiere_create_sequence` | New sequence, made active (`open: false` keeps the previous one active) | Preset `1080p30`: closest installed `.sqpreset` through `qe.project.newSequence`, then exact size and rate through `setSettings`. Also `1080p25`, `1080p24`, `4k30`, `vertical` (1080×1920), `square`. Or `from_clips`. Never the modal New Sequence dialog |
| `premiere_open_sequence` | Make a sequence active | UI only, no undo step |
| `premiere_place_clip` | Item onto a track | Defaults: V1, right after the last clip, `overwrite` (or `insert`). Uses `source_in`/`source_out` when given, then restores the item's own in/out marks. Video brings its linked audio |
| `premiere_edit_clip` | `move` (`to`/`by`), `trim` (`start`/`end`), `enable`/`disable`, `rename`, `speed` (QE), `delete` (`ripple`) | Linked clips move, trim, enable/disable and delete with the clip (`include_linked` true); every member is checked afterwards. A ripple delete shifts the later clips of every touched track by the same amount, the smallest gap, so linked tracks stay in sync. Refused: overlaps, a linked partner pushed before 0, trims into neighbours, trims of retimed clips, locked tracks |
| `premiere_razor` | Cut at a time | Every unlocked track with a clip under `time`, or `tracks`. QE razor per track, read back |
| `premiere_set_clip_properties` | Static Motion / Opacity / volume values | Animated properties refused unless `clear_keyframes` |
| `premiere_animate` | Keyframes on position, scale, rotation, anchor, opacity, volume or `{effect, param}` | `easing` smooth, `replace` true; retimed clips refused |
| `premiere_apply_effect` | Add an effect by Effects-panel name (QE), then set parameters | Unknown names refused with close matches; unknown parameters listed |
| `premiere_add_transition` | Transition at a clip edge (QE) | Cross Dissolve (video) / Constant Power (audio), 0.5 s centred on the cut, `at` end. Each requested edge is read back from the track: a transition already at that edge is replaced (warned), an edge Premiere skipped is warned, and no transition at all is an error |
| `premiere_apply_look` | Lumetri Color look | `strength` 0.6; `clips`, else a `track`, else the selected video clips. Locks and the Lumetri effect are checked for every clip before the first change. A Lumetri already on a clip is reused; re-applying a tinting look then strengthens the tint (warned) |
| `premiere_add_text` | Title rendered by Zenvi Link, or from a transparent PNG (`image`) or an After Effects-authored `.mogrt` | Without `image` or `mogrt` the server renders the title: a transparent PNG at the sequence size with the canvas of the CEP page, inside title-safe, saved in `Zenvi Titles/` next to the project. It uses `font`, `weight`, `stroke`, `shadow`, `box` and `align`. Lowest video track above V1 that is free for the title (for a template: free from its start onward, because Premiere lays it down at its own length first); type scale and reading-time duration from TASTE; the duration actually placed is read back. Any change to a clip already on the track is an error |
| `premiere_add_marker` | Sequence marker, or clip marker (on the source item) | Playhead; name, comment, duration, colour, type comment/chapter/segmentation |
| `premiere_add_captions` | `.srt` into a caption track | `time` 0, format subtitle |
| `premiere_auto_reframe` | Reframed copy for 9:16 / 1:1 / 4:5 / 16:9 | Keeps the source's short side (1080p → 1080×1920); opened |
| `premiere_scene_detect` | Scene Edit Detection: razor at scene changes or add markers | V1, every clip, medium sensitivity; selection restored. Markers land on the source items; `new_markers` counts each item once |
| `premiere_export` | Render to a file | `h264-high` through Media Encoder (queued and started). Also `h264-social-vertical` (9:16 only), `prores-422`, an `.epr`, or `via: direct`. Default output `Zenvi Exports/<sequence>.<ext>` next to the project |
| `premiere_export_xml` | FCP7 XML of a sequence (Premiere → Zenvi) | New file in the temp folder; dialogs suppressed |
| `premiere_import_xml` | Import FCP7 XML and open its sequence (Zenvi → Premiere) | Bin "Zenvi Imports"; offline media reported |
| `premiere_save_project` | Save, or Save As a new `.prproj` | Save As refuses to replace an existing file |
| `premiere_run_script` | Escape hatch: ExtendScript with `app`, `qe`, `ZenviLink` in scope | Returns the completion value as JSON |

### Defaults from TASTE.md

- **Transitions.** Cross Dissolve 0.5 s (1.0 s for a change of time or
  place, passed explicitly), centred on the cut.
- **Easing.** `smooth` by default; never linear on Motion. Each key gets
  Premiere's interpolation from the TASTE curve around it (see
  `premiere_animate` below).
- **Sequences.** 1080p30 by default; vertical is 1080×1920.
- **Titles.**
  - Type scale at a 1080-pixel short side: headline 96, title 72,
    subtitle 44, lower-third 54, caption 42. It scales with the short side,
    so vertical keeps the same sizes.
  - Colour #F7F7F5, title-safe placement.
  - Duration is the reading time, 1.5 s + 0.3 s per word, but at least 3 s
    for titles and 5 s for lower thirds. Shorter durations and lines over 32
    characters get a warning.
- **Looks** are Lumetri deltas from neutral, scaled by `strength` (default
  0.6):
  - `clean`: +5 contrast, +5 vibrance.
  - `warm-film`: temperature +8, tint +2, faded film 8, saturation -6.
  - `teal-orange`: Creative shadow/highlight tint wheels moved 35 % toward
    teal/orange, saturation +6.
  - `moody`: exposure -0.3, contrast +12, saturation -15, vignette -0.8.
  - `bw-contrast`: saturation -100, contrast +25. At the default strength
    that is saturation 40, not black and white; pass `strength: 1` for 0.
- **Exports.**
  - `h264-high` is "Match Source - Adaptive High Bitrate", or "Match Source -
    High bitrate" on older builds.
  - `h264-social-vertical` is the same preset on a 9:16 sequence.
  - `prores-422` is "Apple ProRes 422".

### `premiere_animate`: easing to Premiere interpolation

Premiere's ExtendScript can set a key's interpolation but not its Bezier
handles, so each TASTE curve maps to a mode per key:

| Key | Mode |
| --- | --- |
| Outgoing segment is `hold` | Hold (4) |
| Both neighbouring segments linear | Linear (0) |
| Incoming segment arrives at rest (smooth, out/entrance, in-out, snap) | Ease In (1) |
| Outgoing segment leaves from rest (smooth, in/exit, in-out, snap) | Ease Out (2) |
| Both | Ease In + Out (3) |
| Otherwise (e.g. the fast start of an entrance) | Bezier (5) |

Values 1–3 are the guide's legacy `kfInterpMode_EaseIn/EaseOut/EaseInEaseOut`.
If a build rejects them, the key falls back to Bezier (5) and the receipt
says so.

## How the tools reach Premiere, and how sure we are

| Behaviour relied on | Source | Confidence |
| --- | --- | --- |
| `Time` ticks (254016000000/s); `Sequence.timebase` is ticks per frame | Scripting guide | Documented |
| `Track.overwriteClip` / `insertClip(item, seconds)`; `ProjectItem.setInPoint/setOutPoint(seconds, 4)` | Guide, PProPanel | Documented (seconds vs ticks varies across the guide; PProPanel passes seconds) |
| `source_in` / `source_out` and item in/out marks count from the start of the media, not its source timecode | — | **Unverified** for media whose timecode does not start at 0; the item's original marks are restored as read, so they are unaffected |
| Trims must write `start` + `inPoint` (or `end` + `outPoint`) together; `TrackItem.end` clamps at the media end | premiere-pro-mcp, live on 25.2 | Community-verified |
| `TrackItem.remove(true, …)` does not ripple, so ripple deletes move later clips explicitly | premiere-pro-mcp, live on 25.2–26 | Community-verified |
| `getLinkedItems()` is null for an unlinked clip; only same-source, overlapping clips are treated as partners | premiere-pro-mcp; PProPanel's comment differs | Defensive |
| Built-in components: Opacity (`AE.ADBE Opacity`: Opacity, Blend Mode), Motion (`AE.ADBE Motion`: Position, Scale, Scale Width, Uniform Scale, Rotation, Anchor Point, Anti-flicker) | Live reflection (pymiere), PProPanel, Bruce Bullis's forum answer | Documented by example |
| Position normalised 0–1 to the sequence frame | Brief, common usage | Likely |
| Anchor normalised to the clip frame | — | **Unverified** for clips whose size differs from the sequence |
| Volume Level = 10^((dB - 15)/20) | premiere-pro-mcp, measured on 25.2 | Community-verified |
| Keyframe times are source time (in point added) | premiere-pro-mcp | Community-verified; retimed clips refused |
| Interpolation enum 0 Linear, 4 Hold, 5 Bezier | Guide, PProPanel, Bruce Bullis | Documented |
| Ease modes 1–3 | Guide marks them obsolete | **Unverified** (falls back to Bezier when rejected) |
| Blend Mode index order (alphabetical, then Subtract, Divide; Normal = 18) | premiere-pro-mcp, rendered on 25.2.3 | Community-verified, **check in the test plan** |
| QE track items include gaps; QE `guid` = `sequenceID` | Two live-tested projects | Community-verified |
| `qe.project.newSequence(name, sqpreset)`; `createNewSequence` opens a modal dialog | PProPanel; premiere-pro-mcp on 26.2 | Documented by example |
| `setSettings` frame size and `videoFrameRate` | PProPanel (`changeSequenceColorSpace`) | Documented by example |
| QE `razor(timecode)` per track | pymiere, both live-tested projects | Community-verified |
| QE `addTransition(t, atStart, duration TC, offset, 0.5, singleSided, alignToVideo)` | premiere-pro-mcp (26.3), Adobe_Premiere_Pro_MCP | Community-verified; shorter signatures tried next |
| QE `setSpeed(multiplier, duration ticks, reverse, pitch, ripple)` | Adobe_Premiere_Pro_MCP | **Unverified**; the result is read back through `getSpeed()` and an error is reported when it did not take |
| QE `exportFramePNG(timecode, path without extension)` appends `.png` and cuts the name at its first dot | premiere-pro-mcp, live on 25.2 | Community-verified; a temp folder whose path contains a dot is **unverified** |
| `exportFramePNG` returns before the PNG is written; the capture polls every 100 ms (at most 20 s) until the size is stable and the file has the PNG signature and ends with the IEND chunk (read with `File.seek`) | Zenvi Link review; premiere-pro-mcp only checks that the file exists, since QE's return value is unreliable | Defensive |
| Version gates test that a member exists (`ZenviLink.hasMethod(sequence, "autoReframeSequence")`), not `typeof … === "function"`, because ExtendScript may report host methods as "object" | Zenvi Link review; premiere-pro-mcp's live-tested ExtendScript does use `typeof` checks | Defensive; a test keeps `typeof … === "function"` on DOM members out of the scripts |
| `qe.project.undoStackIndex()` moves by one per undoable step | premiere-pro-mcp on 25.2 | Community-verified; the count is probably capped by the History panel limit (see limits) |
| Scene Edit Detection is `performSceneEditDetectionOnSelection` (types-for-adobe says `performCutDetectionOnSelection`; both are tried) | Guide, PProPanel | Documented |
| MOGRT text: After Effects-authored templates expose JSON `textEditValue` through `getMGTComponent()`; Premiere-authored ones (Basic Title) have no MGT component | Adobe forum; premiere-pro-mcp on 25.2 | Community-verified |
| Auto Reframe keeps the source height; setting the frame size afterwards refits | premiere-pro-mcp on 25.2 | Community-verified |
| Export presets live in `MediaIO/systempresets/<exporter>_<format>` (48323634 = H264, 4D6F6F56 = QuickTime) in Premiere and Media Encoder, plus `~/Documents/Adobe/Adobe Media Encoder/<version>/Presets` | pymiere, premiere-pro-mcp | Community-verified |
| `Marker.end` takes seconds; `setColorByIndex(index)` | Guide, PProPanel | Documented |

Sources:

- Premiere Pro Scripting Guide, https://ppro-scripting.docsforadobe.dev.
- Adobe's PProPanel sample (`Adobe-CEP/Samples`, `PProPanel/jsx/PPRO/Premiere.jsx`).
- types-for-adobe 7.2.6, Premiere/24.0.
- pymiere's reflection of a live Premiere (`work_code/code_generation/class_datas`).
- The MIT-licensed live-tested MCP servers `leancoderkavy/premiere-pro-mcp`
  (CHANGELOG, RESEARCH.md) and `hetpatel-11/Adobe_Premiere_Pro_MCP`. Only
  their findings were used, no code.

## Known limits

- **No undo grouping in Premiere scripting.** A tool that makes several
  changes leaves several undo steps. `qe.project.undoStackIndex()` probably
  stops moving once the undo stack is full (History panel limit). The
  adapter then falls back to the tool's own count, which can be wrong when
  some writes are not undoable.
- **Text.** Premiere's ExtendScript cannot create text, and its bundled title
  templates cannot be filled by script. `premiere_add_text` needs a PNG
  (`image`) or an After Effects-authored `.mogrt`.
  - Without either, the Zenvi Link server renders the title itself
    (`extension/server/titles.js`, SPEC §3.4) with the canvas of its CEP
    page. It asks `ZenviLink.ppro.titleFrame` for the sequence size and the
    project path, draws a transparent PNG at the sequence size, and passes it
    as `image`.
  - Rendered titles are saved in `Zenvi Titles/` next to the project, or in
    the temp folder, with a warning, while the project is unsaved. They are
    named by content, so the same title reuses its file and project item.
  - Without a canvas (a server not running in CEP), the call still refuses
    with what to pass.
  - Changing font size inside a MOGRT's JSON is reported to destabilise
    Premiere, so only a template's own size and colour controls are set.
- **Localised Premiere.** Effect, transition and Lumetri parameter names are
  matched in English.
  - Motion, Opacity and Volume fall back to their documented parameter
    positions.
  - `premiere_apply_look` refuses before any change when QE has no effect
    named "Lumetri Color". When a clip's Lumetri has none of the English
    parameter names, the call stops at that clip with an `UNSUPPORTED`
    error. If it had just added Lumetri Color there, that one effect stays;
    the receipt's `undoSteps` covers it.
- **Speed and keyframes.** Retimed clips (speed ≠ 100 % or reversed) are
  refused for keyframes and trims.
  - Speed changes use the undocumented QE `setSpeed` (Adobe: "there is no API
    call to set trackItem speed"). The result is read back.
- **Sync lock is not scriptable.** Ripple deletes close the gap on the
  clip's own tracks (and its linked partners' tracks) only.
- **Work area.** Exporting the work area relies on `ENCODE_WORKAREA`;
  scripts cannot set the work area itself.
- **Media Encoder.** `app.encoder` is broken on macOS Premiere 14.3.1–15
  (the guide's warning). `via: direct` still works there.
- **Frame capture** writes at the sequence's frame size. A 4K PNG is a large
  image block. A PNG that is not complete after 20 s is an error, and the
  partial file is removed.
- **Temp files.** Frame captures and XML exports go into
  `ZenviLink.tempDir()`, the folder the server configured
  (`<system temp>/zenvi-link` by default). The server deletes a capture only
  from inside it.
- **Auto Reframe** refuses while the sequence is still being analysed
  (`BUSY`).
- **UXP roadmap.** Premiere supports UXP plugins since 25.6. Adobe disables
  CEP by default in Dec 2028 and removes it in Dec 2029. The catalog,
  receipts and protocol do not depend on CEP; a UXP port replaces the
  ExtendScript here with UXP's DOM, which has real undo transactions.

## Development

```bash
npx vitest run --project adobe-link                 # includes the Premiere suites (*.ppro.test.ts)
npm run typecheck:jsx:ppro -w @zenvi/adobe-link     # checkJs over ppro/*.jsx with types-for-adobe Premiere/24.0
npm run typecheck:jsx -w @zenvi/adobe-link          # every tsconfig.jsx*.json (Premiere and After Effects)
npm run gen:catalog -w @zenvi/adobe-link            # after catalog changes
```

- `types/premiere-host.d.ts` declares what the typings lack: the ZenviLink
  runtime, json2, `Object.keys`, the QE DOM as used, and missing DOM
  members. It deliberately leaves out `Array.prototype.indexOf` and
  `String.prototype.trim`, so the typecheck rejects them; use
  `ZenviLink.indexOf` / `trim`.
- The host scripts add nothing to built-in prototypes: every extension in
  Premiere shares one ExtendScript engine, and ES3 cannot hide a prototype
  member from other scripts' `for…in` loops.
- They keep no state between calls either. Opening the panel evaluates the
  bundle again, which rebuilds `ZenviLink`; only `ZenviLink.state` survives,
  and the Premiere tools need nothing in it. Media Encoder jobs are reported
  in the receipt, not tracked.
- DOM feature checks use `ZenviLink.hasMethod(object, name)`, never
  `typeof … === "function"`.
- The mock DOM lives in `src/testing/premiere-mock.ts`, `ppro-components.ts`,
  `ppro-qe.ts` and `ppro-time.ts`; fixtures are in `ppro-fixtures.ts`.

## Manual test plan (Premiere Pro 2024, 2025 or 2026)

**You need:**

- Premiere Pro and Adobe Media Encoder of the same version.
- The Zenvi desktop app, for steps 15–16.
- An MCP client (Claude Code) or `curl` (README, *Debugging*).
- Test media in one folder:
  - three 10–20 s clips with sound (`a.mov`, `b.mov`, `c.mov`; one with a
    camera cut inside),
  - `music.wav`,
  - a 1920×1080 transparent `title.png`,
  - a two-cue `talk.srt`,
  - optionally an After Effects-authored `lower-third.mogrt` with a text
    control.

Record `undoSteps` for each mutating call.

1. **Install and connect.** Run `npm run install:dev -w @zenvi/adobe-link`,
   restart Premiere, open a new project and open *Window → Extensions →
   Zenvi Link*. Click *Copy MCP config* and add it to Claude Code.
   **Pass:**
   - `~/.openshot_qt/link/premiere.json` exists.
   - The panel shows "Running".
   - The client lists 25 `premiere_*` tools.
   - `premiere_get_state` names the project.
2. **Import.** Call `premiere_import_files` with the media paths.
   **Pass:**
   - Every item is in bin *Zenvi Imports*.
   - A second identical call is `unchanged` and returns the same nodeIds.
   - A wrong path is refused and imports nothing.
3. **Sequence.** Call `premiere_create_sequence {name: "Zenvi Test"}`.
   **Pass:**
   - No dialog appears.
   - *Sequence → Sequence Settings* shows 1920×1080 at exactly 30 fps.
   - It is the active sequence.
   - Repeat with `preset: "vertical"`: 1080×1920.
   - Repeat with `open: false`: the previous sequence stays active and the
     receipt's `active` is false.
4. **Three clips.** Call `premiere_place_clip` for a, b and c without `time`,
   with `source_in: 2, source_out: 6` for b.
   **Pass:**
   - Back to back on V1 with linked audio on A1.
   - b is 4 s long and starts 2 s into the media.
   - b's in/out marks in the Source monitor are unchanged.
5. **Dissolves.** Call `premiere_add_transition` on a and on b (defaults).
   **Pass:**
   - Two Cross Dissolves of 00:00:00:15, centred on the cuts.
   - The receipts list their spans.
   - Call it on a again with `transition: "Dip to Black"`: the dissolve at
     that cut is replaced (one transition there, not two) and the receipt
     warns.
6. **Motion keyframes.** Call `premiere_animate` on b: scale `[{time: 0,
   value: 92}, {time: 0.6, value: 100}]`.
   **Pass:**
   - Effect Controls shows two Scale keys at b's first frame and 0.6 s later.
     This checks the source-time mapping on a clip whose in point is not 0.
   - Record the interpolation Premiere shows: expected Ease Out then Ease In
     (or Bezier if it warned).
   - Then animate position from `[960, 540]` to `[1036.8, 540]`: the Position
     numbers in Effect Controls read 960 and 1036.8.
7. **Properties.** Call `premiere_set_clip_properties` on c with
   `blend_mode: "screen"`, `opacity: 85`, `position: [960, 300]`, then
   `volume_db: -6` on the music clip.
   **Pass:**
   - Blend Mode shows *Screen*. This checks the index table; try `multiply`
     and `overlay` too.
   - Opacity reads 85 %.
   - The music's Volume Level reads -6.0 dB, which checks the dB mapping.
   - `premiere_get_sequence` reports the same values back.
8. **Captions.** Call `premiere_add_captions {srt, time: 1}`.
   **Pass:** a subtitle track whose cues start 1 s later than in the file.
9. **Look.** Call `premiere_apply_look {look: "warm-film", clips: [a]}`.
   **Pass:**
   - Lumetri Color on a: Temperature 4.8, Tint 1.2, Faded Film 4.8, Basic
     Saturation 96.4.
   - The look looks warm and skin stays natural (capture a frame).
   - `teal-orange` moves the Creative tint wheels toward teal and orange.
10. **Titles.**
    - Call `premiere_add_text {text: "Launch day", image: title.png}`. On V2
      at the playhead for 3 s.
    - Undo it, put any clip on V2 starting 1 s after where the title ended,
      and call it again. The title lands on V2 again, and that clip keeps its
      start and length. This checks that the still's marks limit what is laid
      down.
    - Call `premiere_add_text {text: "Ada Lovelace", style: "lower-third",
      mogrt: lower-third.mogrt}` with the AE template. The text reads "Ada
      Lovelace". The template goes on a track with nothing after the
      playhead, not into the gap before the clip on V2.
    - With Premiere's own *Basic Title.mogrt* (in
      `…/Essential Graphics/`): refused, with nothing left on the timeline
      (check the History panel).
    - Call `premiere_add_text {text: "Launch day"}` with no `image` or
      `mogrt`. A PNG appears in `Zenvi Titles/` next to the saved project. The
      title shows centred and inside title-safe, with Inter (or the next
      available font) and a soft shadow. Repeat with `style: "lower-third"`:
      the text is left-aligned at title-safe with its baseline at 80 % of the
      frame height.
11. **Edits.** Run `premiere_razor {time: 2}`, then `premiere_edit_clip`:
    - `trim` the right piece's `end`,
    - `move by: 1`,
    - `speed: 0.5` with `ripple: true` (QE setSpeed),
    - `disable` / `enable`,
    - `delete` with `ripple: true`.
    **Pass:**
    - Each result matches the receipt.
    - The speed change shows 50 % in *Speed/Duration*, or an error says it
      did not take.
    - The ripple delete closes the gap on V1/A1 only, by the same amount on
      both, with a warning.
12. **Look before done.** Call `premiere_capture_frame` at 0 s, at the end of
    the scale entrance (b's start + 0.6 s), and mid-title.
    **Pass:**
    - Each returned image matches the Program monitor at that time.
    - Note any opacity-keyframe artifact (reported on 25.2.3 macOS).
13. **Reframe and detect.** Call `premiere_auto_reframe {}`, then
    `premiere_scene_detect {clips: [<the clip with the camera cut>]}`.
    **Pass:**
    - A 1080×1920 "Zenvi Test 9x16" opens.
    - The detected cut appears as a new edit on V1 and A1.
    - The selection is as before.
14. **Export.** Call `premiere_export {}`, then
    `premiere_export {preset: "prores-422", via: "direct"}`.
    **Pass:**
    - Media Encoder starts and renders `Zenvi Exports/Zenvi Test.mp4`.
    - The reported preset is the Match Source high-bitrate H.264.
    - The ProRes file renders inside Premiere.
    - A third call without `overwrite` is refused.
15. **Send to Zenvi.** Open a project in the Zenvi desktop app, then click
    *Send to Zenvi* in the panel.
    **Pass:**
    - Zenvi imports "Zenvi Test" on new tracks.
    - The panel shows the line.
    - With Zenvi closed, the panel says it is not running.
16. **Zenvi → Premiere.** From Zenvi, run `send_to_premiere_tool` (or
    `export_to_premiere_tool`, then `premiere_import_xml {path}`).
    **Pass:**
    - The sequence appears in *Zenvi Imports* and opens.
    - Clips, dissolves, keyframes and markers match Zenvi.
    - Missing media is listed as offline.
17. **Undo.** After a few calls, press ⌘Z / Ctrl+Z `undoSteps` times.
    **Pass:** the edit is back to before the call. Note any call where the
    count was wrong; that means `undoStackIndex` behaves differently.
18. **Optional: another UI language.** Run Premiere in German or Spanish.
    **Pass:**
    - Motion, Opacity and volume tools still work through the parameter
      positions.
    - `premiere_apply_look` refuses, or stops with the English-names
      message after adding at most one Lumetri Color. Note which.

Report which of the **Unverified** and **check** rows in the table above
held, with the Premiere version.
