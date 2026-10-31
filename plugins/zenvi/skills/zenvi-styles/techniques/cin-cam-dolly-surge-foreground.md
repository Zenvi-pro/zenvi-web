---
id: cin-cam-dolly-surge-foreground
kind: technique
summary: "When the film opens into a layered world: a fast 3x surge into the hero while a near object whips past the lens."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [set_keyframes_tool, apply_fx_tool, add_3d_scene_tool, add_sfx_tool]
pace: fast
mood: [immersive, cinematic, depth]
aspect: ["16:9", "9:16"]
pairs_with: [cinematic-parallax, shot-multiplane-slider]
avoid_with: [cinematic-push-in]
needs: []
drawn: cinetic
---

# Dolly surge with a foreground pass

cinetic `cam-dolly-surge-foreground` · Camera · signature · energy high · formats launch, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The camera surges from a wide shot into a 3x medium close-up, with most of the travel in half a second, and at the fastest moment a near object rushes past the lens before a long, slow creep.

Use when: Opening a launch film into a 3D or layered world, or a sting that dives from an overview into the hero object.

## Build it in Zenvi

1. World clip (a 3D render, a layered image, or a photo) on track 1: `set_keyframes_tool {"timeline_clip_id": "<world>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <a>, "value": 1.0}, {"seconds": <a+1.12>, "value": 3.1, "ease": "ease_in_out_cubic"}, {"seconds": <a+1.78>, "value": 3.22, "ease": "ease_out_sine"}]}` and `scale_y` (67 f / 1.12 s, then +4 % creep over 60 f / 1.0 s starting at f47 / 0.78 s, so the motion never stalls). 10-90 % of the travel in about 28 f (0.47 s).
2. Foreground object on its own clip above, 300-400 px off the anchor, scaled with a stronger exponent (k ** 1.6): `scale_x/scale_y` `[{"seconds": <a>, "value": 1.0}, {"seconds": <a+1.12>, "value": 5.0, "ease": "ease_in_cubic"}]` with `location_x` sliding out past the frame edge around the push's peak (~f33 / 0.55 s) at 60-80 px/f or less: `[{"seconds": <a+0.3>, "value": 0.2}, {"seconds": <a+0.7>, "value": 0.85, "ease": "ease_in_cubic"}]`.
3. Streak it with a real blur, not a fake one: `apply_fx_tool {"clip_id": "<fg>", "effects": [{"effect": "directional_blur", "amount": 0.7, "params": {"angle": 0}, "start": 0.4, "end": 0.7}]}` and `{"effect": "radial_blur", "amount": 0.4}` on the world for the peak.
4. Optional mid and far layers at 1.0x and 0.3x of the world translation add parallax (`location_x` at those ratios).
5. Quick 3D route: `add_3d_scene_tool {"scene": "floating_cards", "params": {"fstop": 0.2}, "duration_seconds": 3}`. `add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": <a+0.2>, "gain_db": -10}`.

Fallback: Without separate depth layers, the foreground pass needs a cutout; use a PNG with alpha from the bin or a motion block (`particle_burst`) as the near object.

## Timing & taste rules

- cinetic's timing (60 fps): Push 67 f (1.12 s) on ease_in_out_sine, zoom 1 -> 3.1, 10-90% of the travel in about 28 f (0.47 s), peak about 4.8%/f near a + 33. Creep +4% over 60 f (1.00 s) on linear from a + 47. Foreground exits on the peak at 60-80 px/f or less, smeared by the blur pass.
- Push 67 f (1.12 s) on a smooth ease, zoom 1 to 3.1; 10-90 % of the travel in about 28 f (0.47 s); peak about 4.8 %/f near f33 (0.55 s).
- Creep +4 % over 60 f (1.0 s), linear, starting at f47 (0.78 s): 20 f before the push ends.
- Foreground uses a stronger scale (k^1.6), exits on the peak frame at 60-80 px/f or less, smeared by real blur.
- Optional parallax layers at 1.0x and 0.3x of the camera translation.
- Never fake the streak with a plain blur.

## Sound for it

A whoosh across the surge peaking at the foreground pass; a low swell under the creep.

## Common mistakes

- Flat UI with no depth layers (nothing to pass the lens), or calm walkthroughs (avoid_when).
- A push that stalls at the end: the creep must start 20 f before it ends.
- A foreground object that stays on screen: it must be gone by the peak.
- Avoid when: Flat UI with no depth layers (nothing to pass the lens), or calm walkthroughs.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-dolly-surge-foreground`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
