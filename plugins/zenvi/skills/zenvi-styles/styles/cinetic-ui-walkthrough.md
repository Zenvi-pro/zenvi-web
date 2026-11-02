---
id: cinetic-ui-walkthrough
kind: style
summary: "For a 20-90 s UI walkthrough that teaches a flow: chapters on downbeats, one camera, cursor physics, one caption each."
categories: [cinetic-ui-walkthrough]
tools: [produce_video_tool, get_technique_tool, create_scene_tool, update_scene_tool, render_scene_tool, scene_cues_tool, auto_sound_design_tool, master_audio_tool, export_video_tool, review_render_tool, watch_render_tool]
pace: calm
mood: [clear, helpful, calm, precise]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-guide-cursor-hover-press, cin-cam-fit-bounds-follow, cin-pd-ui-native-transitions, cin-lc-negative-space-caption]
avoid_with: [kcut-strobe-cards, shot-glitch-cycle]
needs: []
---

# Cinetic UI walkthrough

Teach a flow so the viewer can repeat it afterwards: calmer than a launch film but never static. 20-90 s at
90-100 BPM, one chapter per 2-4 bars, one caption of 5 words or fewer per chapter, one anchor camera for the
whole film, a cursor with real physics. Method: `METHOD-cinetic.md`. After cinetic (MIT, (c) 2026
Leonxlnx; see NOTICE).

## When to use / not

Use for "a walkthrough", "an onboarding video", "show how to do X in the app", a feature tour that teaches.
A film that sells rather than teaches: `cinetic-launch-film`. A screen recording with a presenter:
`tech-review` or `talking-head-captions`.

## Structure (beats with timings)

Per chapter (repeat per feature; chapter changes land on downbeats, 100 BPM bar = 2.4 s):

| beat | 30 s | 45 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Hook: the finished result first, moving, the product named | 0-2.4 | 0-2.4 | 0-2.4 | 0-4.8 |
| Chapter 1: establish (wide, caption in the lower third) -> push -> cause -> result -> hand-off | 2.4-12 | 2.4-14.4 | 2.4-19.2 | 4.8-26.4 |
| Chapter 2 | 12-21.6 | 14.4-26.4 | 19.2-36 | 26.4-48 |
| Chapter 3 (and 4) | - | 26.4-40.8 | 36-55.2 | 48-84 |
| Lockup: the last chapter hands off to the name and the one fact | 21.6-30 | 40.8-45 | 55.2-60 | 84-90 |

## Shot plan

- Establish 0.5-1 bar wide on the product (the camera anchor is the whole window) -> push 0.5 bar to the
  feature's anchor on `ease_in_out_sine` (0.35 s + 1.35 ms per px) -> cause 0.5-1 bar -> result 1-2 bars,
  held at least the caption's reading hold -> hand-off 0.25-0.5 bar (a whip or pull-back to the next anchor).
- Chain the anchors: every move starts where the previous ended; during holds the UI drifts 0.5-1.5 px/f.

## Look & grade

The product's own UI is the look; the brand's accent marks the control being used and the result. No glow,
no glass panels around the UI unless that is the product's own chrome.

## Type system

Captions burned in, 28 px or more in the lower third, one per chapter, 5 words or fewer, as one fragment or
a chain of two (never a block of 5); the product's own UI strings are not film copy.

## Motion & transitions

- Cursor (`cursor_path` block, or the person's recording): an arcing path over 36-48 f (0.6-0.8 s), velocity
  that decays, a press to 0.88 over 4 f (0.07 s), at most one click per 30 f (0.5 s).
- Typing at about 20 characters/s, then the line holds 72 f (1.2 s) or more.
- Hand-offs: `apply_motion_transition_tool` `whip` or a pull-back keyframe; two types in the film, plus the
  signature move.

## Sound & music

A light bed with UI clicks at one level, about 3 dB under the music and centred (`add_sfx_tool`
`mouse_click` on each press frame, `keyboard_key` per key while typing or `typing_burst` per word when it
streams fast); master -14 LUFS with a bed, -18 effects only.

## Captions/VO

With a voice-over: `add_captions_tool` from it, the music ducked under the voice, the same 5-word captions.

## Tool sequence

The film is one scene (family `zenvi-scenes`, `get_technique_tool {"technique": "zenvi-scenes"}`):
`produce_video_tool` drafts it from `scenes-feature-loop` with the request's name; rewrite it for this product.
No `build_product_launch_tool`, titles, blocks or 3D on top of it.

```json
produce_video_tool {"request": "<the brief, verbatim>", "style": "cinetic-ui-walkthrough", "length_seconds": 45, "output": "film.mp4"}
get_technique_tool {"technique": "scenes-feature-loop"}
update_scene_tool {"scene_id": "<data.scene.scene_id>", "code": "<the module rewritten: this product's device, copy and brand>"}
render_scene_tool {"scene_id": "<id>", "motion_blur": 4}
auto_sound_design_tool {"genre": "saas_ui", "intensity": "subtle"}
master_audio_tool {"preset": "social", "iterate": true}
export_video_tool {"output_path": "film.mp4"}
review_render_tool {"path": "film.mp4"}
watch_render_tool {"path": "film.mp4"}
```

A walkthrough is chapters: one scene per chapter (the loop's click -> act -> land arc, without the
reset), placed back to back with `render_scene_tool` `position_seconds`, one camera language across them.

## Finish checklist

- [ ] Each chapter: one caption of 5 words or fewer; every result held at least its reading hold.
- [ ] One camera: every move starts where the last ended; never locked off during holds.
- [ ] Cursor arcs, decays, one click per 0.5 s at most, each click with its sound within a frame.
- [ ] UI text 22 px or more after camera scale; captions readable at 480 px.
- [ ] No house-ban or copy-* lines in review_edit_tool; the lockup at the end only.

## Mix-and-match

The draw (format walkthrough) gives product demo and UI choreography first. Never strobes, glitches or
flash frames; the walkthrough's energy is clarity.

## Reference moments

cinetic's gallery walkthrough brief (local only, `~/zenvi-motion/refs2/cinetic/`): the anchor camera chained
from control to control.
