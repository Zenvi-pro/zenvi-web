---
id: shot-outro-group-photo-launch
kind: technique
summary: "When the film ends at its peak: every feature's element flies in to pose round the wordmark under stage light."
categories: [product-launch-film, saas-app-launch, brand-story-corporate, 3d-product-cgi-ad]
tools: [set_keyframes_tool, add_motion_block_tool, add_3d_scene_tool, add_sfx_tool]
pace: fast
mood: [triumphant, glossy, big]
aspect: ["16:9", "1:1"]
pairs_with: [t069, T061, kcut-hit-fx, cinematic-trailer-sound]
avoid_with: [shot-ui-strip-away-outro, shot-ui-to-brand-morph, shot-grain-dissolve]
needs: []
---

# Group-photo launch outro

## What it is
Nine elements the viewer has already seen (a nav, cards, a search field, a stats bar, a doc header, one per feature) fly in from the four sides with spin, land with a soft squash, and pose
around the wordmark as it presses in letter by letter. A crane drop, a stage light behind the logo and rising gold dust make it feel like a launch event. The energy peak of the whole film.

## Build it in Zenvi
Elements are stills (cut from your captures), a wordmark from `logo_reveal_end`, atmosphere from motion blocks.
```json
set_keyframes_tool {"timeline_clip_id": "<element_1>", "property": "location_x", "ease": "ease_out_back", "points": [{"seconds": 0.13, "value": -0.45}, {"seconds": 0.53, "value": -0.30}]}
set_keyframes_tool {"timeline_clip_id": "<element_1>", "property": "rotation", "ease": "ease_out_back", "points": [{"seconds": 0.13, "value": -9}, {"seconds": 0.53, "value": -3.5}]}
set_keyframes_tool {"timeline_clip_id": "<element_1>", "property": "alpha", "points": [{"seconds": 0.13, "value": 0}, {"seconds": 0.25, "value": 1}]}
add_motion_block_tool {"block": "gradient_field", "params": {"style": "bokeh", "colors": ["#2a1f10", "#e8c27a"], "speed": 0.5, "grain": true}, "position_seconds": 0, "duration_seconds": 4.8, "placement": "full_frame"}
add_motion_block_tool {"block": "logo_reveal_end", "params": {"brand": "Northfold", "cta": "", "url": "northfold.example", "glow": true}, "position_seconds": 1.2, "duration_seconds": 3.6, "placement": "over_video"}
add_motion_block_tool {"block": "particle_burst", "params": {"shape": "dots", "count": 20, "origin": [{"x": 0.5, "y": 0.85}], "gravity": -60, "colors": ["#e8c27a"], "rings": false}, "position_seconds": 0.7, "duration_seconds": 4.0}
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 1.35, "gain_db": -12}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": 1.6, "gain_db": -5}
add_sfx_tool {"recipe": "sparkle", "at_seconds": 2.1, "gain_db": -15}
```
Repeat per element (cue 0.13 s + 0.1 s per element, each flight 0.4 s, start offsets +-360 to 500 px). Crane drop: key each element's `scale_x/y` 1.06 -> 1 over the first 1.3 s (there is no group transform). The bokeh field covers the background shot, so no separate blur-up is needed.

## Timing & taste rules
- 145 frames (4.8 s). Elements cue from frame 4 every 3 frames, each flying 12 frames, on an overshoot curve (0.34, 1.4, 0.44, 1): the second control value above 1 is what makes the overshoot (an old curve with 0.9 never crossed 1).
- In flight rotate twice the final angle (final within +-5 degrees), scale 1.12 -> 1, and a directional blur proportional to speed (0.3 x pixels per frame, cap 22); on landing a contact shadow tightens and a 1.5 % squash.
- Every feature shown in the film needs a representative here; viewers notice who is missing.
- When the wordmark enters (42-50 frames) all elements step back: opacity -12 %, saturation -8 %.
- Wordmark: mark first (38 frames), letters from frame 42 at 1.8 frames each, 8 frames per letter; a rule draws 58-70 and shoots 190 px extensions that fade by 76.
- Atmosphere: light sweep frames 2-14 (peak overlay opacity 0.12), stage light 0 -> 0.5 -> 0.25 over frames 42-58, 20 gold specks of 2.4-4.2 px (more than 30 looks like snow) plus 6 soft foreground bokeh.
- Hold the final frame 1 s. Do not add a caption; the tagline appears only once in the whole film.

## Sound for it
Three beats, never changed: `riser_tonal` into the assembly, `impact_boom` on the wordmark (peak, -5 dB), `sparkle` on the rule. Music keeps its hit on the same frame.

## Common mistakes
- Starting conservative (a quiet signature); give it launch-event scale from the first draft.
- Piling on effects before there is a flying-in structure.
- Elements in a ring that all face the camera at the same angle (stiff).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/outro/outro-group-photo-launch.md` (Apache-2.0; see ../NOTICE).
