---
id: cin-cl-rising-wash-carrier
kind: technique
summary: "When a card swap needs one continuous move: a single-hue wash rises behind the type, sweeps up and exits off the top."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, add_title_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [fluid, bridging, warm]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-accent-claim-grounds, kcut-flood-climax, shot-solid-page-wipes]
avoid_with: [cin-cl-inversion-card, cin-cl-light-swell-bridge]
needs: []
drawn: cinetic
---

# Rising colour wash carrier

cinetic `cl-rising-wash-carrier` · Colour and light · accent · energy medium · formats launch, feature, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A soft single-hue field rises from the bottom edge behind the type, swells and sweeps up across the frame on the change, then recedes off the top, so the foreground swap reads as one move.

Use when: Changing cards behind continuous colour, leading into an accent-ground claim or the end card, or smoothing a hard cut into a new scene.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Foreground A and B as in the full build.
2. Flat accent band with a crisp, straight top edge in a light tint of the accent, no radial gradient, no feathered edge: `add_title_tool {"text": " ", "background_color": "<accent_light_tint>", "position_seconds": 0.5, "duration_seconds": 3.4, "track": "1"}` and `add_shape_mask_tool {"clip_ids": ["<band>"], "shape": "rectangle", "x": 0.5, "y": 0.5, "width": 1.2, "height": 1.2, "feather": 0}`.
3. Same `location_y` keyframes as the full build (rise 0.65 s, sweep up 0.2 s, exit off the top over 1.5 s), at full opacity; the swap still happens on the fastest frame.

**Full look** (relies on glow: only when the person's brand supplies that look):

1. Foreground A and B as two kinetic titles back to back, e.g. `add_kinetic_title_tool {"text": "Draft fast", "style": "editorial", "animation": "rise", "position_seconds": 0, "duration_seconds": 2.2}` and the same for B from 2.2 s; the swap happens on the wash's fastest frame.
2. The wash on a track below the type: `add_title_tool {"text": " ", "background_color": "<accent>", "position_seconds": 0.5, "duration_seconds": 3.4, "track": "1"}` then `add_shape_mask_tool {"clip_ids": ["<wash>"], "shape": "ellipse", "x": 0.5, "y": 0.5, "width": 1.4, "height": 1.0, "feather": 0.5}`.
3. Rise 39 f (0.65 s), swell and sweep up 12 f (0.2 s), recede 90 f (1.5 s): `set_keyframes_tool {"timeline_clip_id": "<wash>", "property": "location_y", "points": [{"seconds": 0.5, "value": 0.7}, {"seconds": 1.15, "value": 0.25, "ease": "ease_out_expo"}, {"seconds": 1.35, "value": -0.35, "ease": "ease_in_out_expo"}, {"seconds": 2.85, "value": -1.0, "ease": "ease_out_cubic"}]}` and `scale_x`/`scale_y` 1.0 to 1.55 over the same 1.15-1.35 s sweep.
4. `add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 1.15, "gain_db": -16}`.

## Timing & taste rules

- cinetic's timing (60 fps): The rise takes 39 f (0.65 s) on ease_out_expo. The swell and wipe take 12 f (0.20 s) on ease_in_out_expo (about 28 px/f). The recede takes 90 f (1.50 s) on ease_out_cubic. The pre-cut band takes 16 f (0.27 s) on ease_in_cubic (about +14 luma levels).
- Rise from below the frame to about 47 % coverage over 39 f (0.65 s, ease_out_expo).
- Swell the ellipse from 70 % to 110 % and wipe it up in 12 f (0.2 s, ease_in_out_expo, about 28 px per frame); change the foreground on the fastest frame.
- Recede off the top over 90 f (1.5 s, ease_out_cubic).
- Short version into a hard cut: a bottom band 40 % high rises over 16 f (0.27 s, ease_in_cubic) with the cut landing mid-rise.
- Keep saturation low and the blend normal; use it to preview the accent ground that is coming.

## Sound for it

One soft rising whoosh peaking on the sweep frame; the cut inside the wash gets nothing extra.

## Common mistakes

- Using it on shots already on an accent ground, or over dense UI the wash would tint.
- A soft accent haze behind type that reads as a glow on a brand that bans glows; use the hard-edged band.
- Letting the foreground swap happen before or after the fastest frame; it should hide in the sweep.
- Avoid when: Shots already on an accent ground, or dense UI that the wash would tint. A soft accent haze behind type reads as glow.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-rising-wash-carrier`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
