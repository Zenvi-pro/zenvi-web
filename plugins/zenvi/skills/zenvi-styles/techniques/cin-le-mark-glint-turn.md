---
id: cin-le-mark-glint-turn
kind: technique
summary: "When a premium brand ends on a 3D mark: it turns a few degrees and one light sweep crosses its face."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_3d_scene_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [premium, tactile]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, kinetic-3d-title]
avoid_with: [cin-le-seed-stroke-build]
needs: []
drawn: cinetic
---

# Mark turns through a key light

cinetic `le-mark-glint-turn` · Logo and end card · accent · energy calm · formats launch, sting, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The mark (an extruded glyph, a coin or a tile) turns a few degrees in 3D, and its face passes through a light, so a single specular sweep crosses it as it settles face-on.

Use when: Premium, material or physical brands (finance, hardware, collectibles). 3D marks. A mark that needs one moment of life early in its hold.

## Build it in Zenvi

1. `add_3d_scene_tool {"scene": "logo_extrude", "position_seconds": 4.0, "duration_seconds": 4.0, "quality": "final", "params": {"svg": "<logo.svg>", "material": "chrome", "motion": "tumble", "light_sweep": true}}`: the extruded mark turns about 35 degrees and settles face-on, a light passing across it once (a 40 f, 0.67 s turn, glint starting about f20, 0.33 s).
2. Draft first with `"quality": "draft"` and re-render the final via `rerender_3d_scene_tool`.
3. Place the name under it after the glint: `add_kinetic_title_tool {"text": "ZENVI", "style": "documentary", "animation": "fade", "position_seconds": 4.9, "duration_seconds": 3.0}`.
4. `add_sfx_tool {"recipe": "sparkle", "at_seconds": 4.33, "gain_db": -18}` on the centre of the glint.

Fallback: If Blender is not available, animate a flat mark with `scale_x` 0.92 to 1 (a cheap sense of turning) and no sweep rather than faking a shiny band.

## Timing & taste rules

- cinetic's timing (60 fps): Turn: 40 f (0.67 s) on ease_out_cubic (~4 deg/f peak for 35 deg). Glint: 14 f (0.23 s) on ease_in_out_sine, starting ~f20 (0.33 s). One glint per film.
- Turn 40 f (0.67 s) ease_out_expo, about 4 degrees per frame at the peak for 35 degrees.
- Glint 14 f (0.23 s) ease_in_out_sine, starting about f20 (0.33 s), crossing as the rotation passes about 70 %.
- One glint per film; a band about 30 % of the mark width.
- Extrusion is 6-10 thin layers deep in the look; keep the face crisp.

## Sound for it

A faint sparkle at -18 dB at the glint centre; no impact.

## Common mistakes

- Flat, playful or line marks: a sheen on a stroke looks like a template effect.
- Films with no other 3D.
- A second glint anywhere in the film: it reads as a preset.
- Avoid when: Flat, playful or line marks (a sheen on a stroke looks like a template effect). Films with no other 3D. A second glint anywhere in the film (it reads as a preset).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-mark-glint-turn`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
