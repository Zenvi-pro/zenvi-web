---
id: cin-tx-ramp-masked-stipple
kind: technique
summary: "When a dark film has lit edges or light pools that band: a dithered stipple lives only in the light, not the stage."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, apply_fx_tool, add_shape_mask_tool]
pace: calm
mood: [refined, clean, textured]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-living-stage, cin-cl-key-light-edge-hairline, cin-tx-low-luma-photo-plate]
avoid_with: [cin-tx-global-grain]
needs: [ramp-masked-stipple]
drawn: cinetic
---

# Stipple only in lit ramps

cinetic `tx-ramp-masked-stipple` · Texture and finish · accent · energy calm · formats launch, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A visible dithered stipple lives only inside lit edges and light falloffs, while the flat stage around them stays perfectly clean.

Use when: Dark films with lit edges, light pools or soft falloffs that risk banding, where a global grain would dirty a deliberately clean stage.

## Build it in Zenvi

1. The light pool as its own clip on a track above the clean stage: `add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 6, "params": {"style": "orbs", "colors": ["#0b0c0f", "#2a3a58"], "speed": 0.1, "grain": false}, "track": "2"}`.
2. Stipple that clip only: `apply_fx_tool {"clip_id": "<pool>", "effects": [{"effect": "dither", "amount": 0.12, "params": {"colors": 32, "pixel": 1, "pattern": "bayer", "monochrome": true}}]}`. The stage clip underneath gets no FX.
3. Feather the pool so the stipple dies with the light: `add_shape_mask_tool {"clip_ids": ["<pool>"], "shape": "ellipse", "x": 0.82, "y": 0.18, "width": 0.7, "height": 0.7, "feather": 0.4}`.
4. The mask and the clip move together, so the stipple travels rigidly with the light.

Fallback: cinetic masks a noise tile by the ramp's own alpha; Zenvi's dither FX is applied to the whole pool clip and the feathered mask then hides its edges. Keep the amount low (0.08-0.12) so only the brightest part of the pool shows a texture.

## Timing & taste rules

- cinetic's timing (60 fps): Static texture that moves rigidly with its ramp; high-pass sigma about 1.9 code levels in the brightest ramps, 0.5-0.9 in faint falloffs, 0.0 on the flat stage.
- Static texture that moves rigidly with its ramp.
- Strength: high-pass sigma about 1.9 code levels in the brightest ramps, 0.5-0.9 in faint falloffs, 0.0 on the flat stage.
- Overlay opacity 0.08-0.12 (FX amount 0.08-0.12).
- Check on a stretched crop: stipple inside the ramp, none on the stage.

## Sound for it

None.

## Common mistakes

- Films already running global grain: double texture.
- Light stages, or hard-edged flat design with no ramps.
- Letting the stipple reach the flat stage.
- Avoid when: Films already running global grain (double texture); light stages; hard-edged flat design with no ramps.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-ramp-masked-stipple`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
