---
id: cin-tx-glyph-grid-pulse
kind: technique
summary: "When the film's biggest hit needs a shockwave without colour: a grid of tiny marks flashes and bulges outward."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [digital, impactful, stark]
aspect: ["16:9", "1:1"]
pairs_with: [kcut-hit-fx, cinematic-silence-before-hit, cin-tx-global-grain]
avoid_with: [cin-tx-scanline-transmute, cin-tx-ring-field]
needs: [grid-displacement-pulse]
drawn: cinetic
---

# Glyph-grid shock pulse

cinetic `tx-glyph-grid-pulse` · Texture and finish · accent · energy high · formats launch, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

On the film's biggest hit, the dark background flashes a grid of tiny monoline marks that bend outward from the impact like a shockwave, then settles back to a quiet grained field.

Use when: A digital or developer brand's payoff hit or lockup landing that needs a shockwave without colour or glow.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same hit frame. Plus marks only, every cell on the grid, no scatter: `add_motion_block_tool {"block": "hud_callouts", "position_seconds": 8.0, "duration_seconds": 0.5, "params": {"grid": "crosshair", "labels": [], "points": [[0.5, 0.5]]}}`.
2. Opacity capped at 0.35: `set_keyframes_tool {"timeline_clip_id": "<grid>", "property": "alpha", "points": [{"seconds": 8.0, "value": 0}, {"seconds": 8.07, "value": 0.35, "ease": "ease_out_expo"}, {"seconds": 8.23, "value": 0, "ease": "ease_out_cubic"}]}`.
3. A single displacement ring, monochrome: `add_motion_block_tool {"block": "particle_burst", "position_seconds": 8.0, "duration_seconds": 0.4, "params": {"shape": "rings", "count": 1, "origin": [[0.5, 0.5]], "colors": ["#ffffff"]}}`. No streaks of light.

**Full look** (relies on particles: only when the person's brand supplies that look):

1. Grid of marks on the dark stage, only for the hit: `add_motion_block_tool {"block": "hud_callouts", "position_seconds": 8.0, "duration_seconds": 0.5, "params": {"grid": "full", "labels": [], "points": [[0.5, 0.5]]}, "placement": "over_video"}` (thin monoline marks and anchor rings, white).
2. Shockwave rings from the impact point: `add_motion_block_tool {"block": "particle_burst", "position_seconds": 8.0, "duration_seconds": 0.5, "params": {"shape": "rings", "origin": [[0.5, 0.5]], "count": 3, "colors": ["#ffffff"]}}`.
3. Pulse the grid in and out, peaking 4 f (0.07 s) after the hit: `set_keyframes_tool {"timeline_clip_id": "<grid>", "property": "alpha", "points": [{"seconds": 8.0, "value": 0}, {"seconds": 8.07, "value": 0.6, "ease": "ease_out_expo"}, {"seconds": 8.23, "value": 0, "ease": "ease_out_cubic"}]}`.
4. Bulge: `set_keyframes_tool {"timeline_clip_id": "<grid>", "property": "scale_x", "points": [{"seconds": 8.0, "value": 1.0}, {"seconds": 8.07, "value": 1.04, "ease": "ease_out_expo"}, {"seconds": 8.23, "value": 1.0}]}` (and `scale_y`), about 30 px at the edge.
5. `add_sfx_tool {"recipe": "impact_slam", "at_seconds": 8.0, "gain_db": -6}` on the hit frame; the grid appears with it.

Fallback: Zenvi cannot bend a grid cell by cell from the impact point; the grid scales as one piece and the rings carry the shockwave. Fine on a 12-14 f beat, so do not stretch it longer.

## Timing & taste rules

- cinetic's timing (60 fps): About 12-14 f (0.23 s) visible, peaking 4 f (0.07 s) after the hit (hitPulse(t, 4, 3)); 30 px radial push at peak; once per film.
- About 12-14 f (0.2-0.23 s) visible, peaking 4 f (0.07 s) after the hit.
- Marks 10 px monoline, 1.5 px white strokes on a 36 px cell grid; opacity 0.6 x (1 - distance / radius).
- 30 px radial push at peak; once per film, on the payoff or the lockup's landing.
- Behind finished type only: never behind type that is still arriving.

## Sound for it

`impact_slam` on the hit frame (gain -6 dB), a `sub_drop` at -10 dB under it; the grid shares the same frame.

## Common mistakes

- Calm films, light stages, or a second use in the same film.
- Placing it behind type that is still arriving.
- Letting it scatter, drift or glow; the grid should read as structure.
- Avoid when: Calm films; more than once per film; light stages; behind type that is still arriving.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-glyph-grid-pulse`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
