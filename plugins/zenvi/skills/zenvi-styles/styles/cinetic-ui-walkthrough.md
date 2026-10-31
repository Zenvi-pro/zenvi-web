---
id: cinetic-ui-walkthrough
kind: style
summary: "For a 20-90 s UI walkthrough that teaches a flow: chapters on downbeats, one camera, cursor physics, one caption each."
categories: [cinetic-ui-walkthrough]
tools: [produce_video_tool, save_brief_tool, get_brief_tool, get_technique_tool, set_project_setting_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_motion_block_tool, add_kinetic_title_tool, add_captions_tool, apply_motion_transition_tool, add_sfx_tool, master_audio_tool, review_edit_tool, export_video_tool, review_render_tool, watch_render_tool]
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

```json
produce_video_tool {"request": "<the brief>", "style": "cinetic-ui-walkthrough", "length_seconds": 45}
get_brief_tool {}
get_technique_tool {"technique": "<each drawn pick>"}
set_project_setting_tool {"fps": 60}
add_clip_to_timeline_tool {"file_id": "<screen recording, chapter 1>", "position_seconds": 2.4, "start_seconds": 0, "end_seconds": 12, "track": "1"}
set_keyframes_tool {"timeline_clip_id": "<it>", "property": "scale_x", "points": [{"seconds": 1.2, "value": 1.0}, {"seconds": 2.4, "value": 2.2, "ease": "ease_in_out_sine"}]}
set_keyframes_tool {"timeline_clip_id": "<it>", "property": "location_x", "points": [{"seconds": 1.2, "value": 0}, {"seconds": 2.4, "value": -0.18, "ease": "ease_in_out_sine"}]}
add_motion_block_tool {"block": "cursor_path", "position_seconds": 5.4, "duration_seconds": 4, "params": {"background": "<still of the screen>", "points": [[0.3, 0.6], [0.62, 0.41]], "labels": ["<control>"], "clicks": true}}
add_kinetic_title_tool {"text": "<caption, 5 words or fewer>", "position_seconds": 2.6, "duration_seconds": 2.2, "style": "documentary", "animation": "rise", "y": 0.86}
add_sfx_tool {"recipe": "mouse_click", "at_seconds": 7.1, "gain_db": -18}
apply_motion_transition_tool {"track": "1", "time": 14.4, "preset": "whip", "direction": "left"}
master_audio_tool {"target_lufs": -14}
review_edit_tool {}
export_video_tool {}
review_render_tool {"path": "<render>"}
watch_render_tool {"path": "<render>"}
```

(`scale_y` takes the same points as `scale_x`.)

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
