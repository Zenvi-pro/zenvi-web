---
id: cin-mi-focus-ring-pop-or-trim
kind: technique
summary: "When a click needs a visible result, a thin outline pops outward and fades, or draws round a target without a cursor."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [precise, quiet, pointing]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-guide-cursor-hover-press, cin-ui-outline-led-reveal, shot-scan-annotate]
avoid_with: [cin-mi-radial-dash-burst, shot-neon-frame-landing]
needs: [stroke-erase-from-tail]
drawn: cinetic
---

# Focus ring: pop on click, trim to point

cinetic `mi-focus-ring-pop-or-trim` · Micro-interaction · accent · energy any · formats feature, walkthrough, launch, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A thin outline around a control either pops outward and fades the moment it is clicked, or draws itself clockwise around a target and erases from the tail, pointing at the action without a cursor.

Use when: A click needs a visible result the next shot can build on, or a calm frame must point at the next action without moving a cursor.

## Build it in Zenvi

1. The ring is a rounded-rectangle outline around the control, drawn as a path: `add_type_block_tool {"block": "write_on", "paths": ["M<r> 0 H<w-r> A<r> <r> 0 0 1 <w> <r> V<h-r> A<r> <r> 0 0 1 <w-r> <h> H<r> A<r> <r> 0 0 1 0 <h-r> V<r> A<r> <r> 0 0 1 <r> 0 Z"], "view_box": [0, 0, <w>, <h>], "x": <cx>, "y": <cy>, "width": <control_width + outset>, "stroke_width": 3, "fill": false, "ink": "<accent_or_ink>", "position_seconds": <press>, "duration_seconds": 0.5, "draw_seconds": 0.02}`, a crisp 2-3 px stroke, no blur.
2. Pop mode: on the press frame the ring grows from a 4 px to a 14 px outset over 8 f (0.13 s): `set_keyframes_tool {"timeline_clip_id": "<ring>", "property": "scale_x", "points": [{"seconds": <press>, "value": 1.0}, {"seconds": <press+0.13>, "value": 1.1, "ease": "ease_out_expo"}]}` (same for scale_y; 4 to 14 px on a 200 px control is roughly 1.1 to 1.0 scaled), and `alpha` 0.9 to 0 `linear` over 20 f (0.33 s). For a handoff keep it at the 14 px outset as the next element's border.
3. Trim mode: the ring draws clockwise over 24 f (0.4 s): the same `write_on` with `draw_seconds: 0.4` and a 6 px outset, then fades from its start over the next 24 f (0.4 s) with `alpha` 1 to 0 on `ease_in_out_sine` (a 48 f / 0.8 s loop). Repeat on the next target about 108 f (1.8 s) later.
4. Use the accent only when its one meaning is act here; otherwise ink on light stages and white on dark.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <press>, "gain_db": -24}` on pop mode; none on trim mode.

Fallback: write_on draws a stroke but cannot erase it from the tail; fade the whole ring out after it closes (about 0.4 s) for a nearly identical read.

## Timing & taste rules

- cinetic's timing (60 fps): Pop: outset 4 to 14 px in 8 f (0.13 s) ease_out_expo; opacity 0.9 to 0 over 20 f (0.33 s), linear from the press. Trim: draw 24 f (0.40 s) and erase 24 f (0.40 s), both ease_in_out_sine (a 48 f (0.80 s) loop); dashes 10/8 px, 3 px stroke; next target about 108 f (1.80 s) later.
- Pop: outset 4 to 14 px in 8 f (0.13 s) on ease_out_expo; opacity 0.9 to 0 linear over 20 f (0.33 s) from the press.
- Trim: 24 f (0.4 s) to draw, 24 f (0.4 s) to erase, both on ease_in_out_sine; dashes 10 / 8 px, 3 px stroke.
- Next target about 108 f (1.8 s) later while the cursor rests nearby.
- No glow, no blurred halo: the stroke stays crisp.

## Sound for it

A quiet ui_tap at -24 dB on the pop frame; the trim ring is silent.

## Common mistakes

- The cursor already sits on the target: the ring is redundant.
- A ring that needs a glow or blurred halo to read.
- Accent used when it already means something else in the film.
- Avoid when: The cursor already sits on the target (the ring is redundant), or the ring would need a glow or blurred halo to read.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-focus-ring-pop-or-trim`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
