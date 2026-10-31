---
id: cin-le-seed-stroke-build
kind: technique
summary: "When the mark is geometric: it grows from a seed while strokes and stripes draw on, the label rising beside it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_type_block_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [constructed, crisp]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, cin-le-mark-slide-name-follow]
avoid_with: [cin-le-gooey-merge-to-mark]
needs: []
drawn: cinetic
---

# Seed build with stroke draw-on

cinetic `le-seed-stroke-build` · Logo and end card · workhorse · energy medium · formats launch, sting, feature, loop, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The mark grows from a small seed while its strokes, stripes or arcs draw on in a quick stagger, so it assembles itself in about half a second and the label rises in beside it.

Use when: Geometric marks made of a body plus lines, stripes or orbits. A fresh logo reveal after a hard cut to a clean stage. Stings that must show the mark within 0.5 s.

## Build it in Zenvi

1. Body from a seed: the mark's body path as `add_type_block_tool {"block": "write_on", "paths": ["<body d>"], "fill": true, "ink": "#ffffff", "width": 0.14, "draw_seconds": 0.05, "x": 0.4, "y": 0.5, "position_seconds": 2.0, "duration_seconds": 4.0}` with `set_keyframes_tool` `scale_x/y` 0.2 to 1.0 over 54 f (0.9 s) `ease_out_expo`.
2. Each line or stripe part its own write_on, drawn on 10 f (0.17 s) each, 6 f (0.1 s) apart, starting at 2.0 + 0.1 + 0.1 i: `add_type_block_tool {"block": "write_on", "paths": ["<part d>"], "fill": false, "stroke_width": 6, "draw_seconds": 0.17, "position_seconds": 2.1}`; filled stripes use `fill: true` with a `scale_x` 0 to 1 from one end (`origin_x` 0).
3. When the last part lands (about 2.4 s) the label rises beside it: `add_kinetic_title_tool {"text": "Pulse", "style": "documentary", "animation": "rise", "stagger_seconds": 0.033, "text_size": 0.07, "position_seconds": 2.4, "duration_seconds": 3.5}`.
4. Push the whole group gently through the hold: `scale_x/y` 1.0 to 1.1 over 1.5 s `ease_in_out_sine` on every piece.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 2.1, "gain_db": -16}` and a `hit_transient` at -12 dB on the label.

## Timing & taste rules

- cinetic's timing (60 fps): Seed growth: 54 f (0.90 s) on ease_out_expo (about 0.2x -> 1; first-frame edge speed ~4 px/f). Parts: 10 f (0.17 s) each, 6 f (0.10 s) apart (3 parts inside ~28 f (0.47 s)). Label glyphs: 2 f (0.03 s) apart, 12 f (0.20 s) each on ease_out_expo. The whole mark reads within ~0.5 s. Then a 90-120 f (2.00 s) hold that pushes from 1.0 to 1.10-1.15 on ease_in_out_sine (le-living-hold).
- Seed grows 54 f (0.9 s) ease_out_expo from about 0.2x; first-frame edge speed about 4 px/f.
- Parts 10 f (0.17 s) each, 6 f (0.1 s) apart; 3 parts inside about 28 f (0.47 s); label glyphs 2 f apart, 12 f (0.2 s) each.
- The whole mark reads within about 0.5 s; hold 90-120 f (1.5-2 s) pushing 1.0 to 1.10-1.15.
- Not more than about 5 parts.

## Sound for it

A tap on the first stroke and one hit on the label; no per-stroke sounds.

## Common mistakes

- Solid single-shape marks: there is nothing to draw.
- Marks with more than about 5 parts: it becomes a slow queue.
- A mark already on screen as the story device.
- Avoid when: Solid single-shape marks (there is nothing to draw). Marks with more than ~5 parts (it turns into a slow queue). The mark already exists on screen as the story device.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-seed-stroke-build`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
