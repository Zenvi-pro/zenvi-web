---
id: shot-brand-ink-open
kind: technique
summary: "When a film opens on the name: a crosshair is inked, the wordmark presses in, a kicker types, then a full-second hold."
categories: [brand-story-corporate, product-launch-film, saas-app-launch, documentary-true-story]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [quiet, premium, tactile]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-title-sequence, kinetic-write-on, t069]
avoid_with: [shot-fracture, shot-magician-card-flourish]
needs: []
---

# Ink-and-press brand open

## What it is
The first 2.8 seconds give the brand something to remember before any UI: a hairline crosshair draws (vertical, then horizontal) and fades, the wordmark
presses into the paper letter by letter, a small kicker types in, and the lockup stands completely still for one second before floating up and out.
It starts the energy curve low on purpose.

## Build it in Zenvi
```json
add_motion_block_tool {"block": "hud_callouts", "params": {"title": "", "labels": [], "values": [], "grid": "crosshair"}, "position_seconds": 0, "duration_seconds": 1.2, "placement": "over_video"}
add_motion_block_tool {"block": "kinetic_headline", "params": {"text": "northfold", "kicker": "MOTION & IDENTITY", "style": "blur", "emphasis": "display", "max_size": 220},
  "position_seconds": 0.35, "duration_seconds": 3.0, "placement": "over_video"}
set_keyframes_tool {"timeline_clip_id": "<headline_clip>", "property": "location_y", "ease": "ease_in", "points": [{"seconds": 2.75, "value": 0}, {"seconds": 2.98, "value": -0.04}]}
set_keyframes_tool {"timeline_clip_id": "<headline_clip>", "property": "alpha", "ease": "ease_in", "points": [{"seconds": 2.75, "value": 1}, {"seconds": 2.98, "value": 0}]}
add_sfx_tool {"recipe": "tail_bloom", "at_seconds": 0.4, "gain_db": -16}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 2.6, "gain_db": -18}
```
Ground: a warm paper colour (a `gradient_field` with one colour, grain on, or a title clip with `background_color`). Also scale the headline 1 -> 0.88 in the exit.
If the crosshair parameters are rejected, leave it out: the hold still carries the shot.

## Timing & taste rules
- Crosshair: vertical 0-9 frames, horizontal 8-18, fade 24-34; it must be gone before the wordmark has settled.
- Wordmark: letters start 10 frames in, 3 frames apart, 12 frames each, from scale 1.6 to 1 with blur 6 px -> 0 (pressed from above, baseline anchored).
  "Opacity + move/scale + blur to 0" is the entrance triad; without the blur it looks hard.
- Kicker types at 0.7 frame per character, because it is decorative (body text needs ~3 frames per character).
- Hold the settled wordmark for a full second (frames 46-76). Shorter reworks it.
- Exit is faster than the entrance: 7 frames, up 40 px, 12 % smaller, fading.
- Open low: a showy first shot flattens the climb to the end.

## Sound for it
One soft `tail_bloom` or `ui_tap` as the mark lands (-16), a short `whoosh_short` to the first product shot. No game-UI taps.

## Common mistakes
- Giving the hold to an ordinary card instead of the wordmark landing.
- Leaving the crosshair on screen so it competes with the name.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/opening/brand-ink-open.md` (Apache-2.0; see ../NOTICE).
