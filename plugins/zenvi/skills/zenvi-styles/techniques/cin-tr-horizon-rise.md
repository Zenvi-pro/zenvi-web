---
id: cin-tr-horizon-rise
kind: technique
summary: "When one colour event splits the film into acts: a huge disc rises like a planet and its dark core becomes the stage."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [add_motion_block_tool, set_keyframes_tool, apply_fx_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [epic, atmospheric, act break]
aspect: ["16:9", "9:16"]
pairs_with: [cinematic-title-sequence, shot-aurora-flip, kinetic-mask-reveal]
avoid_with: [cin-tr-portal-aspect-zoom]
needs: []
drawn: cinetic
---

# Horizon rise

cinetic `tr-horizon-rise` · Transition · accent · energy medium · formats launch, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A huge disc rises from the bottom edge like a planet horizon, its rim washing over the frame, until its dark core swallows the screen and becomes the stage for the next line.

Use when: A single colour event that divides the film into acts (UI section to brand moment), or a calm lift from a statement into the next card.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. One hue only: the dark core with a rim of the accent at full strength: `add_motion_block_tool {"block": "shape_morph", "params": {"shapes": ["circle"], "style": "outline", "colors": ["<accent>"], "size": 2.4}}` over a dark disc, falling off by opacity of the same accent (`alpha` 1 to 0.3 on a second slightly larger ring); no bloom, no second hue.
2. Or a hard-edged ink disc with a 1.5 px accent edge rising over a paper stage: `style: "duo"` circle, `location_y` 1.6 to 0.08 over 56 f on `ease_in_out_sine`.

**Full look** (relies on gradient, glow: only when the person's brand supplies that look):

1. The disc: `add_motion_block_tool {"block": "shape_morph", "position_seconds": <T>, "duration_seconds": 1.2, "placement": "over_video", "params": {"shapes": ["circle"], "style": "fill", "colors": ["#0a0d1a"], "size": 2.2, "spin": false}}` (radius about 1.1x the frame width, dark core in the next act's stage colour) on track 3.
2. Rim: a second slightly larger circle behind it in a rim colour, `{"colors": ["#c96a3b"], "size": 2.5}` on track 2, then `apply_fx_tool {"clip_id": "<rim>", "effects": [{"effect": "bloom", "amount": 0.5}]}` for the soft 30 px falloff.
3. Rise: `set_keyframes_tool {"timeline_clip_id": "<disc>", "property": "location_y", "mode": "replace", "points": [{"seconds": <T>, "value": 1.6}, {"seconds": <T+0.93>, "value": 0.08, "ease": "ease_in_out_sine"}]}`, the same on the rim with a slightly earlier end; 56 f (0.93 s), about 2570 px of travel, the rim's leading edge peaks near 70 px/f mid-move. At rest the core covers all four corners.
4. Next text from about f46 (0.77 s), inside the core: `add_kinetic_title_tool {"text": "Meet the new way", "position_seconds": <T+0.77>, "duration_seconds": 2.5, "style": "editorial", "animation": "rise"}`.
5. Lighter version: a rim band 40 % of frame height rising over 16 f (0.27 s, `ease_in_cubic`) with the cut landing mid-rise on the beat. `add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": <T>, "gain_db": -12}` and `{"recipe": "sub_drop", "at_seconds": <T+0.9>, "gain_db": -10}`.

Fallback: The soft falloff bands on gradients when scaled; stack the rim with bloom and add `apply_look_tool` film grain (dither) over the whole shot.

## Timing & taste rules

- cinetic's timing (60 fps): Rise: 56 f (0.93 s) on ease_in_out_sine, about 2570 px of centre travel at 1080p (the rim's leading edge peaks near 70 px/f mid-move). Next text from about frame 46. Band version: 16 f (0.27 s) on ease_in_cubic. The core fills the frame on a downbeat.
- Rise 56 f (0.93 s) on a smooth ease-in-out, ~2570 px of centre travel at 1080p.
- Dark core out to 55 % of the radius, rim bands to 85 %, softened ~30 px.
- Next text from ~f46 (0.77 s), inside the core.
- Core fills the frame on a downbeat; band version 16 f (0.27 s) on an ease-in.
- Once per film.

## Sound for it

A slow `whoosh_rise` across the 56 f and a `sub_drop` on the frame the core fills the screen.

## Common mistakes

- More than once per film, or on a light film where the dark core would be the only dark frame (avoid_when).
- A visible gradient band: soften and dither it.
- Starting the text before f46: it fights the rim.
- Avoid when: More than once per film, or on a light film where the dark core would be the only dark frame.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-horizon-rise`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
