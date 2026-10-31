---
id: cin-mi-radial-dash-burst
kind: technique
summary: "When one hero word lands on a beat, dashes burst out around it, drift while it is read, then fly out."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [add_kinetic_title_tool, add_motion_block_tool, set_keyframes_tool, add_sfx_tool, add_type_block_tool]
pace: fast
mood: [punchy, graphic, emphatic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-slam-word, kinetic-keyword-slam, kinetic-emphasis-scale]
avoid_with: [kinetic-beat-strobe, cin-mi-focus-ring-pop-or-trim]
needs: []
drawn: cinetic
---

# Radial dash burst around a word

cinetic `mi-radial-dash-burst` · Micro-interaction · accent · energy high · formats launch, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Short dashes burst outward around a hero word on the beat, drift almost imperceptibly while it is read, then fly outward faster as the frame pushes into the cut.

Use when: A single hero word on a beat needs a physical punch.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Replace the random dashes with 12 evenly spaced radial ticks, one every 30 degrees, 20 px (0.019 of height) long, 3 px stroke, in the ink colour: `add_type_block_tool {"block": "write_on", "paths": ["M<x1> <y1> L<x2> <y2>", "..."], "view_box": [0, 0, 1000, 1000], "stroke_width": 3, "fill": false, "x": 0.5, "y": 0.5, "width": 0.5, "position_seconds": 0.0, "duration_seconds": 1.6, "draw_seconds": 0.05}` (one ordered ring, 12 paths).
2. Drive them with the same radius curve as ONE clip: scale 1.0 to 1.47 (187 to 274 px) over 16 f (0.27 s) `ease_out_expo`, a slow 0.5 px/f drift, then out to about 450 px (scale 2.4) over the last 20 f (0.33 s) on `ease_in_cubic`: `set_keyframes_tool {"timeline_clip_id": "<ticks>", "property": "scale_x", "points": [...]}` and `scale_y`.
3. A single 2 px ring stroke on the same curve also works. Camera push and sound unchanged.

**Full look** (relies on particles, confetti: only when the person's brand supplies that look):

1. The hero word: `add_kinetic_title_tool {"text": "<WORD>", "animation": "pop", "position_seconds": 0.0, "duration_seconds": 1.6}` on the beat.
2. Full look, the random dash burst: `add_motion_block_tool {"block": "particle_burst", "params": {"shape": "lines", "count": 22, "origin": [{"x": 0.5, "y": 0.5}], "gravity": 0, "rings": false}, "position_seconds": 0.0, "duration_seconds": 1.6, "motion_blur": 6}` starting on the beat the word lands: dashes 4x20 px (about 2 % of height long), radius 187 px (0.17 of height) growing 87 px over 16 f (0.27 s), drifting 0.5 px/f for about 50 f (0.83 s), then 176 px further over the last 20 f (0.33 s) as the camera pushes into the cut.
3. Camera push into the cut: `set_keyframes_tool {"timeline_clip_id": "<word_and_burst>", "property": "scale_x", "points": [{"seconds": 1.27, "value": 1.0}, {"seconds": 1.6, "value": 1.2, "ease": "ease_in_cubic"}]}` (same for scale_y).
4. `add_sfx_tool {"recipe": "impact_punch", "at_seconds": 0.0, "gain_db": -8}`.

## Timing & taste rules

- cinetic's timing (60 fps): Burst +87 px in 16 f (0.27 s) ease_out_expo; drift 0.5 px/f for about 50 f (0.83 s); exit +176 px over the last 20 f (0.33 s) ease_in_cubic into the cut.
- Burst +87 px in 16 f (0.27 s) on ease_out_expo, drift 0.5 px/f for about 50 f (0.83 s), exit +176 px over the last 20 f (0.33 s) on ease_in_cubic into the cut.
- 22 dashes at 60-80 % opacity, 4x20 px, oriented radially.
- Motion blur on the burst and the exit.
- Start on the beat the word lands, once per film.

## Sound for it

An impact_punch at -8 dB on the beat the word lands, and a whoosh_short at -18 dB across the last 20 f (0.33 s) of the exit.

## Common mistakes

- Body copy, UI shots or a film that already used the burst: it is a one-word punch.
- Dashes that cross the word: keep the inner radius clear of the glyphs.
- Using the random version where the brand bans particles: use the ordered ring.
- Avoid when: The text is body copy, the shot is UI, or the burst has already been used once in the film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-radial-dash-burst`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
