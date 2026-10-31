---
id: cin-dn-status-pill-ring
kind: technique
summary: "When the proof is a real process: a small capsule shows a live dot, a step label, a ring filling to the current step."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [calm, technical]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-voice-input-pill, shot-control-state-change]
avoid_with: [kinetic-lower-third]
needs: [status-pill-ui-block]
drawn: cinetic
---

# Process-status pill with ring progress

cinetic `dn-status-pill-ring` · Data and numbers · accent · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A compact capsule shows where a process stands in one glance: a live dot, a mono step label, a ring filled to the current percentage, the step count and a grey date.

Use when: Proving that a real, structured process exists (pipeline, build, delivery) as an overlay on process footage.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same capsule on a solid fill with a thin hairline outline (the `write_on` body plus a 1.5 px outline path), no frosted or translucent glass, depth only from a soft drop shadow (`add_vignette_tool` is not it; draw a second darker path offset 4 px at 16 % alpha).
2. Keep the live dot, the ring and the one step line "Step 5/6 · Motion"; drop the tracked mono uppercase label and the grey date.

**Full look** (relies on glass, filler-text: only when the person's brand supplies that look):

1. Pill body: `add_type_block_tool {"block": "write_on", "paths": ["M30 0 h340 a30 30 0 0 1 0 60 h-340 a30 30 0 0 1 0 -60z"], "fill": true, "ink": "#1d1f24", "width": 0.3, "x": 0.5, "y": 0.8, "draw_seconds": 0.01, "position_seconds": 2.0, "duration_seconds": 3.0}` on track 4.
2. Ring: `add_type_block_tool {"block": "write_on", "paths": ["M14 0 a14 14 0 1 1 -0.01 0"], "fill": false, "ink": "#4f8cff", "stroke_width": 3, "draw_seconds": 0.5, "x": 0.58, "y": 0.8, "position_seconds": 2.17, "duration_seconds": 2.8}` (fills 4/6 to 5/6 over 30 f, 0.5 s).
3. Texts: `add_title_tool {"text": "Step 5/6 · Motion", "template": "Standard_1", "font_scale": 0.5, "position_seconds": 2.0, "duration_seconds": 3.0, "track": "6"}` and a small accent dot (`add_emoji_tool` with a plain circle or a title bullet).
4. Capsule rises 24 px with the others: `set_keyframes_tool {"property": "location_y", "ease": "ease_out_cubic", "points": [{"seconds": 2.0, "value": 0.022}, {"seconds": 2.4, "value": 0}]}` and `alpha` 0 to 1 over 0.17 s on each piece.
5. Dot pulse at the ring's 50 % frame (2.67 s): `scale_x/y` 1 to 1.4 to 1 over 0.23 s. `add_sfx_tool {"recipe": "toggle", "at_seconds": 2.67, "gain_db": -20}`.

Fallback: No pill block exists; this is assembled from a write_on path, a title and keyframes. For a quicker look use the data_table block with one row and a status chip.

## Timing & taste rules

- cinetic's timing (60 fps): Arrival on ease_out_quart (~24 f (0.40 s) to settle). Ring fill 30 f (0.50 s) on ease_out_expo. Step roll 14 f (0.23 s). Dot pulse: attack 2 f (0.03 s), tau 8 f (0.13 s). Visible 46-90 f (1.50 s).
- Capsule radius about 25 % of its height; dot 8 px, ring r 14 px with a 3 px stroke at 1080p.
- Arrival: rise 24 px (0.022) over about 24 f (0.4 s) with opacity over 10 f (0.17 s); ring fill 4/6 to 5/6 over 30 f (0.5 s) ease_out_cubic.
- Step digit rolls on the fill's 50 % frame (14 f, 0.23 s); dot pulses once with a 2 f attack and 8 f decay.
- Visible 46-90 f (0.8-1.5 s).

## Sound for it

A faint toggle on the step change, -20 dB; the arrival gets none.

## Common mistakes

- A step or percentage that is not true to the story.
- Frames that already carry a headline, which the pill competes with.
- Frosted glass or filler labels when the ban-safe variant is required.
- Avoid when: The step and percentage aren't true to the story; frames that already carry a headline, which the pill would compete with.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-status-pill-ring`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
