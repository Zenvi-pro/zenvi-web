---
id: cin-lc-negative-space-caption
kind: technique
summary: "When each camera move ends on a product pose: leave a clean band of stage and build the caption inside it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, add_title_tool, add_kinetic_title_tool]
pace: calm
mood: [clean, guided, premium]
aspect: ["16:9", "1:1"]
pairs_with: [cin-lc-opposite-corner-relay, shot-cursor-flyover, shot-crane-rise-reveal]
avoid_with: [cin-lc-one-centred-subject, kinetic-vo-captions]
needs: []
drawn: cinetic
---

# Caption in the subject's negative space

cinetic `lc-negative-space-caption` · Layout and composition · workhorse · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Each camera move ends on a pose where the product covers about two-thirds of the frame and leaves a clean band of empty stage, and the caption builds inside that band.

Use when: Single-take product walkthroughs and 3D UI slabs where each feature gets one pose and one caption; any shot where text laid over the UI would fight it.

## Build it in Zenvi

1. Frame the end pose so the product covers 65-75 % of the frame and leaves a 25-30 % band on the side it turns away from: `set_keyframes_tool {"timeline_clip_id": "<product>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 1.4, "value": 1.35, "ease": "ease_in_out_sine"}]}`, `scale_y` the same, and `location_x` to push the product to one side (for example -0.12).
2. Caption in the band, at most 24 % of the frame width, 2-3 words per line, left aligned, inset 8-10 % from the frame edge: `add_title_tool {"template": "Standard_1", "text": "One click\nto publish", "position_seconds": 1.05, "duration_seconds": 2.0, "fade_in_seconds": 0.43, "fade_out_seconds": 0.23, "track": 3}`, then `set_keyframes_tool` on `location_x` (+0.28 for a right band) and `scale_x/y` to hold it narrow.
3. For a word-by-word build use `add_kinetic_title_tool {"text": "One click to publish", "style": "documentary", "animation": "rise", "stagger_seconds": 0.133, "position_seconds": 1.05, "duration_seconds": 2.0, "y": 0.5}` and move the clips into the band with `set_keyframes_tool` `location_x`.
4. Start the caption in the last 25 % of the move, or within 6 f (0.1 s) of landing; fade it out as one block (12-16 f, 0.2-0.27 s) before the next camera move starts.

## Timing & taste rules

- cinetic's timing (60 fps): Caption starts at 75% of the move, or within 6 f (0.10 s) of landing; Words stagger 8 f (0.13 s), dur 26 f (0.43 s). Block exit 12-16 f (0.27 s) on ease_in_out_sine, ending as the next move starts. Camera moves on ease_in_out_sine.
- Subject 65-75 % of the frame, clear band 25-30 %, caption at most 24 % of the frame width and inset 8-10 % from the edge.
- Caption starts at 75 % of the move or within 6 f (0.1 s) of landing; word stagger 8 f (0.13 s), each word 26 f (0.43 s).
- Block exit 12-16 f (0.2-0.27 s) on ease_in_out_sine, ending as the next move starts.
- Camera moves ride ease_in_out_sine (start gently, settle slowly).
- Vertical frames: the band goes top or bottom only.

## Sound for it

A soft swish_airy at -18 dB as the camera starts a move, if any; the caption itself is silent.

## Common mistakes

- Subjects that must stay full frame to be read: put the caption above or below instead.
- Setting the caption over the UI: it fights the product; keep it in the empty band.
- Starting the caption long after the camera has landed: type and camera should settle as one gesture.
- Avoid when: The subject must stay full-frame to be legible (caption above or below it instead), or a 9:16 frame, where the band should be top or bottom only.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-negative-space-caption`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
