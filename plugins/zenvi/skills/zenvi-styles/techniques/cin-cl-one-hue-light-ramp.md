---
id: cin-cl-one-hue-light-ramp
kind: technique
summary: "When a dark launch film needs one recognisable look: all light (rims, rings, end-card field) from five steps of one hue."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, add_guide_overlay_tool, add_motion_block_tool, add_kinetic_title_tool, apply_look_preset_tool, add_sfx_tool]
pace: calm
mood: [cohesive, dark, luminous]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-living-stage, cin-cl-key-light-edge-hairline, cin-tx-global-grain]
avoid_with: [cin-cl-mono-one-accent, cin-cl-context-palette-shift]
needs: [hard-edged-gradient-band-field]
drawn: cinetic
---

# One-hue light ramp

cinetic `cl-one-hue-light-ramp` · Colour and light · workhorse · energy calm · formats launch, sting, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Every lit thing (rims, rings, stage lifts, the end-card field) comes from adjacent lightness steps of one hue on a single near-black stage.

Use when: Dark launch films with many light-built shapes (orbs, rings, rims) that need a recognisable look. It also makes a single bright card hit harder.

## Build it in Zenvi

1. Pick five steps of one hue from the near-black stage to a pale tint: `<s0>` stage, `<s1>` 20 %, `<s2>` 45 %, `<s3>` 75 % toward the accent, `<s4>` accent mixed 50 % with white. Use only these everywhere.
2. Stage: `add_title_tool {"text": " ", "background_color": "<s0>", "position_seconds": 0, "duration_seconds": 12, "track": "1"}`. Keep it at 63-99 % of pixels on dark frames.
3. Rims and rings as crisp strokes, never soft halos: `add_guide_overlay_tool {"kind": "ring", "clip_id": "<hero_clip>", "color": "<s3>", "stroke_width": 4, "start": 2.0, "duration": 3.0}`.
4. End-card field: `add_motion_block_tool {"block": "gradient_field", "position_seconds": 9.0, "duration_seconds": 2.0, "params": {"style": "aurora", "colors": ["<s0>", "<s2>", "<s4>"], "speed": 0.2, "grain": true}}`, then `add_kinetic_title_tool {"text": "Zenvi", "style": "editorial", "animation": "rise", "ink": "#ffffff", "position_seconds": 9.4, "duration_seconds": 1.6}`.
5. Global finish: `apply_look_preset_tool {"look": "film_grain_35mm_fine", "scope": "all"}` so the soft ramps do not band.

Fallback: The aurora field is soft, not the cinetic hard-edged 60-120 px bands. Keep it very slow (speed 0.2) and low in contrast between the two adjacent steps; do not add a glow on top.

## Timing & taste rules

- cinetic's timing (60 fps): The palette stays the same. The end-card field holds 90-120 f (2.00 s) with the bands drifting 0.3 px/f on linear.
- Gradients only ever run between two adjacent steps of the ramp, so the whole film's light is one decision.
- Rims, rings and orb lobes are crisp strokes or flat fills in the upper steps; never bloom them.
- End-card field holds 90-120 f (1.5-2.0 s) and keeps drifting (about 0.3 px per frame) so the hold never freezes.
- Grain sits over every ramp at 1.5-2 % to stop banding.
- Stage holds 63-99 % of the pixels on dark frames; one bright card then hits harder.

## Sound for it

None for the look itself. The end-card wordmark gets one soft `add_sfx_tool {"recipe": "tail_bloom", "at_seconds": 9.4, "gain_db": -16}` when it resolves.

## Common mistakes

- Light-mode walkthroughs where the UI's own colours dominate.
- Mixing this with a monochrome-plus-accent system: pick one colour system per film.
- Soft halos or bloom on the rims; they break the one-hue crispness.
- Avoid when: Light-mode walkthroughs where the UI's own colours dominate, or films already using the monochrome-plus-accent system (pick one system).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-one-hue-light-ramp`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
