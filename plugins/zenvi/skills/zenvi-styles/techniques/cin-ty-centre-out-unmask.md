---
id: cin-ty-centre-out-unmask
kind: technique
summary: "When a result or status line sits under an icon: it opens from its own centre outward while the letters stay still."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, add_shape_mask_tool, set_keyframes_tool, fade_clip_tool, add_sfx_tool]
pace: calm
mood: [confirming, tidy]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-control-state-change, shot-blur-slide]
avoid_with: []
needs: []
drawn: cinetic
---

# Centre-out line unmask

cinetic `ty-centre-out-unmask` · Typography in motion · workhorse · energy calm · formats feature, walkthrough, launch, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A short line opens from its own centre outward behind a soft-edged mask while the letters stay perfectly still, so a result or status reads as unveiled rather than flown in.

Use when: A result, status or confirmation line under a centred icon ('Published', 'Connected'). A hero word inside a pill that has just formed. A calm sub-line under a headline that has already landed.

## Build it in Zenvi

1. After the icon landing at 2.0 s: `add_kinetic_title_tool {"text": "Published", "style": "documentary", "animation": "fade", "stagger_seconds": 0, "text_size": 0.05, "y": 0.62, "position_seconds": 2.08, "duration_seconds": 2.5}`.
2. Open it from the centre: `add_shape_mask_tool {"clip_ids": ["<title>"], "shape": "rectangle", "x": 0.5, "y": 0.62, "width": 0.4, "height": 0.1, "feather": 0.02, "keyframes": [{"seconds": 2.08, "grow": -0.4}, {"seconds": 2.38, "grow": 0}]}` (18 f, 0.3 s, both edges travelling outward with a soft 20 px edge).
3. `set_keyframes_tool {"timeline_clip_id": "<title>", "property": "alpha", "points": [{"seconds": 2.08, "value": 0.6}, {"seconds": 2.38, "value": 1}]}`; a second line opens the same way 6 f (0.1 s) later.
4. Exit: `fade_clip_tool {"clip_id": "<title>", "fade_out_seconds": 0.2}`.
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 2.08, "gain_db": -20}`.

Fallback: The 0.04 em tracking tighten while opening is not available; keep only the unmask and opacity ramp.

## Timing & taste rules

- cinetic's timing (60 fps): Unmask over 18 f (0.30 s) on ease_out_expo (31% of each half-width opens on frame 1), with a 20 px feather. Opacity 0.6 -> 1 and tracking +0.04 em -> token over the same 18 f (0.30 s). Starts 4-6 f (0.10 s) after the icon lands; a second line follows at +6 f (0.10 s). Hold at least 36 f (0.60 s) + 6 f (0.10 s) per word, drifting at most 0.3 px/f. Exit over 12 f (0.20 s) on ease_in_out_sine.
- Unmask 18 f (0.3 s) ease_out_expo, 31 % of each half-width open on frame 1; 20 px feather.
- Opacity 0.6 to 1 over the same window; start 4-6 f (0.07-0.1 s) after the icon lands, second line +6 f.
- Hold at least 36 f + 6 f per word, drifting at most 0.3 px/f.
- Exit the line together over 12 f (0.2 s).

## Sound for it

A faint pop at -20 dB as the line opens, tied to the icon landing, or none.

## Common mistakes

- Lines over about 40 characters: the edges take too long to reach the ends.
- Left-aligned layouts, where the wipe should start from the left edge.
- Text that is also moving, where the mask fights the glyph motion.
- Avoid when: Lines over about 40 characters (the edges take too long to reach the ends). Left-aligned layouts (wipe from the left edge instead). Text that is also moving, where the mask fights the glyph motion. Headlines that need energy.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-centre-out-unmask`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
