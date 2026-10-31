---
id: cin-ps-breath-envelope
kind: technique
summary: "When no card may look frozen: arrive fast, keep drifting through the hold, accelerate out and cut on the fastest frame."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, set_keyframes_tool, apply_fx_tool]
pace: fast
mood: [rhythmic, alive, assertive]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-emphasis-scale, cin-ps-locked-camera-holds, kcut-hit-fx]
avoid_with: [cin-ps-locked-camera-holds, cin-ps-one-long-hold]
needs: []
drawn: cinetic
---

# Breath envelope per card

cinetic `ps-breath-envelope` · Pacing and structure · workhorse · energy medium · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Every card arrives fast and decelerates, keeps moving gently through its hold, then accelerates away and is cut on its fastest frame.

Use when: Statement cards, kinetic type and feature cards in a fast-cut film where nothing should ever look frozen.

## Build it in Zenvi

1. Card or title on its track: `add_kinetic_title_tool {"text": "<statement>", "style": "creator", "animation": "slide_up", "position_seconds": 0, "duration_seconds": 1.8, "stagger_seconds": 0.067}` (or any card clip).
2. One scale curve with three terms on the clip: `set_keyframes_tool {"timeline_clip_id": "<card>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.08}, {"seconds": 0.6, "value": 1.0, "ease": "ease_out_expo"}, {"seconds": 1.5, "value": 1.02}, {"seconds": 1.77, "value": 1.08, "ease": "ease_in_cubic"}]}` and the same for `scale_y`. Arrival 36 f (0.6 s), hold 36 f + 6 f per word at +0.06 %/f, exit 16 f (0.27 s), hard cut on the last frame.
3. A little vertical travel for text: `set_keyframes_tool` on `location_y` from +0.047 (90 px) to 0 over the arrival, and to -0.052 (100 px) over the exit.
4. Blur only while the card moves faster than 12 px/f: `apply_fx_tool {"clip_id": "<card>", "effects": [{"effect": "directional_blur", "amount": 0.4, "start": 0, "end": 0.25}, {"effect": "directional_blur", "amount": 0.4, "start": 1.6, "end": 1.77}]}`.
5. Next card starts the frame after the cut, already moving.

## Timing & taste rules

- cinetic's timing (60 fps): Arrival 20-50 f (0.83 s) ease_out_expo (default 36, peak about 15 px/f). Hold = 36 f (0.60 s) + 6 f (0.10 s) per word at 0.4-1 px/f or +0.06%/f scale; the drift rate is never 0 for more than 6 f (0.10 s). Exit 14-20 f (0.33 s) ease_in_cubic, reaching 19-39 px/f on the cut frame. Example U: 14 then 3 then 39 px/f across 56 f (0.93 s). No near-still run over about 22 f (0.37 s) before the end card.
- Arrival 20-50 f (0.33-0.83 s) on ease_out_expo, default 36 f (0.6 s), peak about 15 px/f.
- Hold = 36 f + 6 f per word (a 5-word card is 66 f, 1.1 s) at 0.4-1 px/f or +0.06 %/f scale; drift is never zero for more than 6 f (0.1 s).
- Exit 14-20 f (0.23-0.33 s) on ease_in_cubic, reaching 19-39 px/f on the cut frame; example U: 14, 3, 39 px/f across 56 f (0.93 s).
- No near-still run over about 22 f (0.37 s) before the end card.
- The terms add, so speed follows a U and never touches zero mid-card.

## Sound for it

A hit only on the cut frame when the card is a statement; the arrival and exit are covered by the bed.

## Common mistakes

- Dense UI that needs a dead-still read: lock the camera instead.
- Using it on the final lockup hold, which should stay still.
- Cutting at the end of a decelerated exit instead of on its fastest frame.
- Avoid when: Dense UI that needs a dead-still read (lock the camera instead), and the final lockup hold.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-ps-breath-envelope.mp4` (1280x720p60, a white card PNG (scale 0.3) on a flat card: scale_x/scale_y 1.08x to 1.0 (ease_out_expo, 0.6 s), 1.02x at 1.5 s and 1.08x at 1.77 s (ease_in_cubic), location_y 0.047 to 0 to -0.052, whoosh_short at 0): sampling the clip with get_clip_properties_tool gave scale 0.324 at 0 s, 0.3005 at 0.3 s, 0.3 at 0.6 s, 0.3023 at 1.0 s, 0.306 at 1.5 s, 0.3213 at 1.75 s and location_y 0.047, 0.001, 0, 0, 0, -0.044, so the three-term curve (arrive, slow growth, accelerating exit) is as described; I did not look at frames; watch judge 1.6/10.

Found when rendering it (apply before building):

- Step 4: apply_fx_tool refuses stills and titles (Error: clip ... is not video footage; FX render video clips), so the directional blur only works on video clips; for a card, title or PNG use add_effect_tool {"timeline_clip_id": "<card>", "effect": "Blur", "properties": {"horizontal_radius": [{"time": 0, "value": 8}, {"time": 0.25, "value": 0}], "vertical_radius": [...]}} with keyframes in timeline seconds.
- Steps 2-3: for a clip that does not start at 0 the points need timeline_seconds; scale values are multiples of the clip's own base scale (card base 0.3: 1.08x is 0.324), not 1.08 absolute; the sample curve landed as written.
- Step 1: a kinetic title is one clip per word, each scaled about its own corner, so a three-term scale on the words would scatter them; apply this curve to a card clip, or use the per-word pivot compensation (scale S*f and location C + f*(loc - C)).

Translated from cinetic's technique library (`ps-breath-envelope`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
