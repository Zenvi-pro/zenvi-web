---
name: after-effects
description: Drive Adobe After Effects through Zenvi Link (the mcp__zenvi__ae_* tools) with a motion designer's taste - build and animate comps, titles, lower thirds, kinetic type, logo reveals, motion presets, looks, masks and renders, and look at frames before saying done. Use when the user mentions After Effects, an AE comp or .aep project, motion graphics to make in After Effects, or wants to send a Zenvi edit to After Effects or bring a comp back into Zenvi.
---

# After Effects with Zenvi Link

Zenvi Link is a small extension inside After Effects. It gives the `zenvi`
MCP server `ae_*` tools that act on the project open in After Effects, with
tasteful defaults: an omitted argument still looks professional.

## Connect first

1. Call `list_hosts`. The `after-effects` entry says whether After Effects is
   connected, which project it has open, and which host is active.
2. Not connected: After Effects is not running, or Zenvi Link is not
   installed. Run `/zenvi:adobe-setup` (it uses `zenvi adobe doctor` and
   `zenvi adobe install`), then the user restarts After Effects. Do not try
   to drive After Effects any other way.
3. `ae_*` tools missing from your tool list: Zenvi Link is not installed on
   this machine yet (they are listed once it is), or the server runs with
   `ZENVI_MCP_ADOBE=off`.

## Ground truth before every change

- `ae_get_state` first, and again whenever the user may have changed
  something by hand: project, active comp, selection, render queue.
- `ae_get_comp` (layers with `layer_id`, timing, switches, effects, animated
  properties), `ae_get_layer` (values at a time, keyframes with easing,
  effects, text, masks, expressions), `ae_list_items`, `ae_list_effects`.
- Comps: `comp` = `comp_id` or exact name (default: the active comp).
  Layers: `layer` = `layer_id` (a number, stable when layers move),
  `{"index": n}` (1 = top) or the exact name. Times are seconds, snapped to
  the comp's frame grid; `warnings` say when a time moved.
- Every mutating `ae_*` call is exactly one undo step (named
  "Zenvi: <tool title>"); `ae_undo {steps}` reverts. A `refused` receipt
  changed nothing: read `error.message` and fix the call.

## Building blocks

| Intent | Tool |
| --- | --- |
| New comp | `ae_create_comp` (`preset`: `1080p`, `4k`, `vertical` 1080x1920, `square`, `720p`; fps 30, 10 s by default) |
| Comp settings | `ae_set_comp` (duration, fps, size, background, work area, motion blur) |
| Footage | `ae_import_files` (into "Zenvi Imports", deduped), then `ae_add_layer {kind: "footage"}` |
| Solids, shapes, nulls, adjustment layers, cameras, lights | `ae_add_layer {kind}` |
| Titles, lower thirds, captions | `ae_add_text` (`style`, `placement`, optional `animation`), `ae_set_text` |
| Animated entrances / exits / holds | `ae_apply_motion_preset` (`fade-in`, `fade-out`, `slide-in`, `slide-out`, `scale-pop`, `blur-in`, `typewriter`, `word-cascade`, `line-rise`, `ken-burns`, `push-in`, `drift`, `whip-in`) |
| Exact keyframes | `ae_animate` (`keyframes: [{time, value}]`, named `easing`, `replace`) |
| Any property | `ae_set_property` (path such as `Transform/Position`), `ae_add_expression` |
| Timing, switches, parenting, mattes | `ae_set_layer`, `ae_arrange_layers` (move / duplicate / delete / split) |
| Effects and looks | `ae_apply_effect`, `ae_set_effect`, `ae_apply_look` (`clean`, `warm-film`, `teal-orange`, `moody`, `bw-contrast`) |
| Masks, precomps, markers | `ae_add_mask`, `ae_precompose`, `ae_add_marker` |
| Look at it | `ae_capture_frame {time}` (an image of the comp at that time) |
| Render / save | `ae_render` (`preset` h264, prores-422, prores-4444…; `mode` render_now blocks After Effects), `ae_save_project` |
| Last resort | `ae_run_script` (ExtendScript, ES3: no let/const/arrow functions/template strings), `ae_run_jsx_file` |

Prefer the catalog tools over scripts: they validate first, keep one undo
step per call, and apply the taste defaults below.

## Taste (from zenvi://taste)

Read `zenvi://taste` for the full guide. The rules that matter most here:

- **Intent first.** Every move answers "what should the viewer notice
  next?" One easing family, one or two type families, one accent colour.
- **Timing.** Entrances 0.5-0.8 s (default 0.6 s), exits 0.35-0.5 s (0.4 s:
  exits are faster), micro pops 0.2-0.35 s, big moves 0.8-1.2 s (1.0 s).
  Stagger 0.06 s per word, 0.12 s per line. Text holds at least
  1.5 s + 0.3 s per word. Lower third 4-6 s in total; title card 2.5-4 s.
- **Easing.** `smooth` (0.33, 0, 0.20, 1) by default; `out`/`entrance`
  (0.16, 1, 0.30, 1) for arrivals; `in`/`exit` (0.70, 0, 0.84, 0) for
  departures; `in-out` between two resting states; `snap` for punchy pops.
  Never `linear` on anything that moves (only opacity crossfades, looping
  rotations, tickers). Overshoot only for playful brands, at most 6 % of
  the distance, as an extra keyframe.
- **Space.** Text inside title-safe (10 % inset; vertical 9:16 also keeps
  out of the top 12 % and bottom 20 %: x 108-972, y 230-1536 at 1080x1920).
  Align left edges to a 12-column grid. Entrances travel 3-6 % of the width
  (default 4 %), not from off-screen; scale entrances 92 % to 100 %; Ken
  Burns 3-6 % over the shot. Lower third: left at title-safe, name baseline
  at ~80 % of the height (70 % vertical), role below at 0.25 x name size.
- **Type.** Inter, then SF Pro Display, Helvetica Neue, Arial. At 1080 px:
  headline 96, title 72, subtitle 44, lower-third name 54 / role 34, caption
  42. Headlines tracked -1 to -2 %, all-caps labels +6 to +10 %; leading 1.1
  (headlines) / 1.3 (body); at most 32 characters per line, no orphans.
  Text over video gets a 35-55 % scrim or a soft shadow (distance 0,
  softness 12-20 px, 40 %).
- **Colour.** Without a brand: ink #0B0B0F, paper #F7F7F5, accent #FF5A36,
  secondary #2F6BFF. Looks at 60 % strength or less; skin stays natural.

Example, a lower third that follows the guide with almost no arguments:
`ae_add_text {"text": "Ana Ruiz", "subtitle": "Head of Design", "style":
"lower-third", "placement": "lower-third", "animation": "slide-in", "start":
1, "duration": 5}`, then `ae_apply_motion_preset {"layer": <layer_id>,
"preset": "fade-out", "start": 5.6}`.

## Look before you say done

1. Capture frames with `ae_capture_frame` at the first frame, every entrance
   end, the middle of each hold and the last frame.
2. Check each against the review checklist: inside title-safe and readable
   at phone size? anything linear or stopping abruptly? durations inside the
   timing table, holds long enough to read? aligned to the grid and to
   siblings? exactly one focal point? (Audio: no clipping, music ducked.)
3. Fix with the tools, capture the same moments again, and report what you
   checked and any deliberate exceptions. The `edit_review` prompt
   (host `aftereffects`) runs the same loop.

## Between Zenvi and After Effects

- **Zenvi project to After Effects:** `send_to_after_effects_tool` (the Zenvi
  desktop app rebuilds the timeline as a comp inside the connected After
  Effects) or `export_to_after_effects_tool` (writes a `.jsx` the user can
  run, or you run with `ae_run_jsx_file`). Read the warnings: effects
  without an After Effects equivalent are listed.
- **After Effects comp to Zenvi:** `bring_from_after_effects {comp, alpha}`
  renders the comp (ProRes 4444 when `alpha`, else H.264) and adds it to the
  Zenvi project as a linked clip. After the comp changes,
  `rerender_linked_clip_tool` brings the new version in.
- Both need a saved Zenvi project (`open_project_file`); the desktop app is
  opened on it when needed. `zenvi://handoff` lists what survives each way.
