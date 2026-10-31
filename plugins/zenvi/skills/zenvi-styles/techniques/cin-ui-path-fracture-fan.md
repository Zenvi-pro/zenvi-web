---
id: cin-ui-path-fracture-fan
kind: technique
summary: "When an old way is full of friction, one line breaks into a fan of curves ending on obstacle pills, then funnels back."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [diagrammatic, tense, resolving]
aspect: ["16:9", "1:1"]
pairs_with: [cin-ui-stalled-state, cin-ui-orbit-gather-merge, shot-source-hub-connect]
avoid_with: [cin-ui-card-grid-arrival, shot-cursor-flyover]
needs: [dashed-stroke-degrade]
drawn: cinetic
---

# Path fractures into a fan, then re-converges

cinetic `ui-path-fracture-fan` · UI choreography · accent · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A solid line draws out, breaks into dashes, splits into a fan of curves that end on obstacle pills, and later the curves funnel back into one point that becomes the next diagram.

Use when: Explaining the friction of an old way (one simple path turning into many obstacles) before the turn to one clean path.

## Build it in Zenvi

1. Trunk: `add_type_block_tool {"block": "write_on", "paths": ["M0 0 L1 0"], "x": 0.3, "y": 0.5, "width": 0.3, "stroke_width": 4, "position_seconds": 0.0, "duration_seconds": 0.6, "draw_seconds": 0.2}` (12 f = 0.20 s linear draw).
2. Fan: 6 bezier curves from one shared point, ends spread +-200 px in y (+-0.185 of frame height): `add_type_block_tool {"block": "write_on", "paths": ["M0 0 C..", "..."], "position_seconds": 0.43, "duration_seconds": 1.2, "draw_seconds": 0.55}` (they draw one after another, about 24 f = 0.4 s each is too slow in sequence, so keep the total at 0.55 s).
3. Obstacle pills, one per curve end, popping as the curve arrives: `add_title_tool {"text": "<obstacle>", "background_color": "#ffffff", "position_seconds": 0.5, "duration_seconds": 1.4, "fade_in_seconds": 0.13}` then `set_keyframes_tool {"timeline_clip_id": "<pill>", "property": "scale_x", "points": [{"seconds": 0.5, "value": 0.9}, {"seconds": 0.63, "value": 1.0, "ease": "ease_out_expo"}]}` (8 f = 0.13 s).
4. Punch-in cut about 10 f (0.17 s) after the fan ends: `set_keyframes_tool {"timeline_clip_id": "<group>", "property": "scale_x", "interpolation": "constant", "points": [{"seconds": 1.17, "value": 2.5}]}` (same for scale_y, aimed with location).
5. Re-converge: a second write_on with 6 paths ending on one point, 24 f (0.4 s) `draw_seconds`, while the next diagram starts at that point.

Fallback: There is no dashed stroke: skip the break-into-dashes beat and let the solid trunk cut straight into the fan, or draw the dashes as a row of "-" glyphs from add_title_tool.

## Timing & taste rules

- cinetic's timing (60 fps): Trunk 12 f (0.20 s) (linear); dashes at +12 f (0.20 s) over 8 f (0.13 s) to '24 12'; fan at +26 f (0.43 s): 6 curves x 24 f (0.40 s) (ease_out_cubic), 2 f (0.03 s) stagger, complete at +60 f (1.00 s); punch-in cut at ~+70 f (2.5x). Converge 24 f (0.40 s) (ease_in_out_sine); camera landing 210 px over 60 f (1.00 s) (ease_out_expo), 22 px/f at its start.
- Trunk draws in 12 f (0.20 s) linear; the break to dashes takes 8 f (0.13 s); the fan starts 26 f (0.43 s) after the trunk and finishes by +60 f (1.0 s).
- Drawing head stays under about 70 px/f; the six curves are staggered 2 f (0.03 s).
- Punch-in is a hard cut to 2.5x, about 10 f (0.17 s) after the fan completes, not a move.
- Whole diagram act is under about 4 s.

## Sound for it

One ui_tap at -22 dB when each pill pops (6 taps, 2 f apart, keep only every other one); a soft whoosh_short on the re-converge at -20 dB.

## Common mistakes

- Real product UI on screen: this is diagram language and a diagram act past about 4 s loses the thread.
- Pills too small to read at the punch-in: size the labels for 2.5x.
- Fan curves drawn all at the same instant: the stagger is what shows the friction multiplying.
- Avoid when: The viewer needs real product UI on screen; this is diagram language, and a diagram act longer than about 4 s loses the thread.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-path-fracture-fan`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
