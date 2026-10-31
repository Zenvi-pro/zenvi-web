---
id: cin-cl-rim-light-sweep
kind: technique
summary: "When flat dark UI cards float on black: a bright streak runs along the card's border over a faint lit rim to give depth."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, apply_look_preset_tool, add_type_block_tool, set_keyframes_tool]
pace: calm
mood: [sleek, dark, technical]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-key-light-edge-hairline, shot-neon-frame-landing, shot-spotlight-hero-card]
avoid_with: [cin-cl-tilt-linked-sheen]
needs: [svg-path-write-on, per-side-coloured-halo]
drawn: cinetic
---

# Rim streak on card edges

cinetic `cl-rim-light-sweep` · Colour and light · accent · energy calm · formats feature, launch, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A bright streak travels along a dark card's border while its edges carry a faint lit rim, separating it from a black stage without a drop shadow.

Use when: Flat dark UI cards floating on pure black that need depth and separation without tilting or shadows.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same dark card: `add_motion_block_tool {"block": "data_table", "position_seconds": 0, "duration_seconds": 6, "params": {"title": "Pipeline", "columns": ["Name", "Status"], "rows": ["Render|Done", "Export|Live"], "plate": "solid"}}`.
2. Lift with a neutral low-opacity shadow (0 24 px 48 px at 50 % of the stage colour): `apply_look_preset_tool {"timeline_clip_id": "<card>", "look": "shadow_soft"}`; no coloured halos.
3. One 1 px single-colour edge highlight sweeping the border: `add_type_block_tool {"block": "write_on", "paths": ["M 120 80 H 1800 Q 1840 80 1840 120 V 960 Q 1840 1000 1800 1000 H 120 Q 80 1000 80 960 V 120 Q 80 80 120 80 Z"], "view_box": "0 0 1920 1080", "stroke_width": 1, "ink": "#ffffff", "position_seconds": 1.0, "duration_seconds": 0.5}`.

**Full look** (relies on glow, gradient, orange: only when the person's brand supplies that look):

1. The card, a dark UI block: `add_motion_block_tool {"block": "data_table", "position_seconds": 0, "duration_seconds": 6, "params": {"title": "Pipeline", "columns": ["Name", "Status"], "rows": ["Render|Done", "Export|Live"], "plate": "solid"}}`.
2. Faint lit rim and separation without a heavy drop shadow: `apply_look_preset_tool {"timeline_clip_id": "<card>", "look": "shadow_subtle"}`.
3. The streak: draw the card outline as an SVG rounded-rectangle path with `add_type_block_tool {"block": "write_on", "paths": ["M 120 80 H 1800 Q 1840 80 1840 120 V 960 Q 1840 1000 1800 1000 H 120 Q 80 1000 80 960 V 120 Q 80 80 120 80 Z"], "view_box": "0 0 1920 1080", "stroke_width": 2, "ink": "#ffffff", "position_seconds": 1.0, "duration_seconds": 0.5}` so a bright 1-2 px line runs the edge in 20-30 f (0.33-0.5 s) linear.
4. Breathe the rim for the whole UI act: `set_keyframes_tool {"timeline_clip_id": "<outline>", "property": "alpha", "points": [{"seconds": 1.5, "value": 0.6}, {"seconds": 3.0, "value": 0.8, "ease": "ease_in_out_sine"}, {"seconds": 4.5, "value": 0.6, "ease": "ease_in_out_sine"}]}` (180 f = 3 s period, 0.6-0.8).
5. Coloured halos on three sides (the brand-supplied look): `apply_look_preset_tool {"timeline_clip_id": "<card>", "look": "glow_soft_white"}` is the nearest single glow.

Fallback: Zenvi's write_on draws a line that stays, it does not run a short segment around the border and vanish; and the glow looks are all-round, not a different colour per side. Use the whole-outline draw-on as the streak and keep the rim at 0.6 alpha.

## Timing & taste rules

- cinetic's timing (60 fps): The streak crosses one edge in 20-30 f (0.50 s) on linear. The rim breathes ±20% over 180 f (3.00 s) and stays on for the whole UI act.
- Card fill sits just above the stage; the border is a 1 px white line at about 8 % alpha.
- The streak crosses one edge in 20-30 f (0.33-0.5 s, linear); the segment is about 120 px long.
- The static rim breathes plus/minus 20 % (0.6-0.8) over 180 f (3 s) for the whole UI act.
- Only one card carries a streak at a time.

## Sound for it

None, or a very faint `sparkle` (-24 dB) as the streak starts; the shimmer is a quiet detail.

## Common mistakes

- Light-mode UI: use a soft neutral shadow instead.
- Several cards with streaks at once; they compete.
- Coloured halos on a brand that bans glows; use the hairline variant.
- Avoid when: Light-mode UI (use a soft neutral shadow instead), or several cards on screen at once (the streaks compete).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-rim-light-sweep`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
