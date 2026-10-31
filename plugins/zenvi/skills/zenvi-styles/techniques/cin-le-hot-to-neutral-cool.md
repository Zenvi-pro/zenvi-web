---
id: cin-le-hot-to-neutral-cool
kind: technique
summary: "When the accent meant heat early on: the app icon pops in hot, cools to its neutral colours, lifts and gets its name."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, apply_color_tool, set_effect_property_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [cooling, resolved]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, cin-le-mark-ticks-in-lockup]
avoid_with: [cin-le-slam-spin-pullout]
needs: []
drawn: cinetic
---

# Accent icon cools to its neutral mark

cinetic `le-hot-to-neutral-cool` · Logo and end card · accent · energy medium · formats launch, feature, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The app icon pops up from tiny in the film's hot accent, cools through darker tones to its neutral final colours, lifts a little to make room, and the name fades in beneath it.

Use when: Films whose accent stood for heat, urgency or the problem early on and should cool into the product. App-icon lockups.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same pop and lift, but the tile starts in the film's single accent as a flat fill (not a multi-hue gradient) and cools through darker shades of that same hue to neutral ink: grade it with `apply_color_tool` lowering `exposure` and `saturation` only, no warm-to-red ramp.

**Full look** (relies on gradient, orange: only when the person's brand supplies that look):

1. `add_clip_to_timeline_tool {"file_id": "<icon>", "position_seconds": 4.0, "duration_seconds": 4.0, "track": "3"}` with `set_keyframes_tool` `scale_x/y` 0.19 to 1.0 over 38 f (0.63 s) `ease_out_expo` (0.72 by f6, 0.1 s).
2. Cool it as one object: `apply_color_tool {"timeline_clip_id": "<icon>", "color": {"temperature": 0.6, "saturation": 1.3}}`, then `set_effect_property_tool` with keyframes bringing temperature and saturation to neutral over 28 f (0.47 s, from f6 to f34) `ease_in_out_sine`; never two crossfaded copies.
3. Lift to make room: `location_y` 0 to -0.094 (102 px) and `scale_x/y` 1 to 0.945 over 36 f (0.6 s) `ease_in_out_sine`.
4. As the lift passes 60 % fade the label up: `add_kinetic_title_tool {"text": "Pulse", "style": "documentary", "animation": "rise", "position_seconds": 4.95, "duration_seconds": 3.0, "y": 0.62}` (15 f, 0.25 s, from 8 px).
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 4.0, "gain_db": -12}`.

Fallback: A true mixed-colour cool (OKLab between two fills) needs the logo supplied in both colourways; cross-dissolve is forbidden here, so use the single graded clip.

## Timing & taste rules

- cinetic's timing (60 fps): Pop: 38 f (0.63 s) on ease_out_expo (0.19 -> 0.72 by f6 (0.10 s)). Colour: 28 f (0.47 s) (f6 (0.10 s)-34) on ease_in_out_sine. Lift: 36 f (0.60 s) on ease_in_out_sine. Label: 15 f (0.25 s). Then hold 90-120 f (2.00 s) under a push.
- Pop 38 f (0.63 s) ease_out_expo, 0.19 to 0.72 by f6; colour cool 28 f (0.47 s) from f6 to f34, smooth.
- Lift 36 f (0.6 s): up 102 px and scale 1 to 0.945; label 15 f (0.25 s) from 8 px, starting as the lift passes 60 %.
- Then hold 90-120 f (1.5-2 s) under a push.
- One accent, one meaning: the heat must have been the accent earlier.

## Sound for it

A pop on the icon; nothing during the cool.

## Common mistakes

- The accent already means something else in the film.
- Icons whose final colour is the accent itself.
- Cooling by crossfading two copies instead of one graded object.
- Avoid when: The accent already means something else in the film (one accent, one meaning). Icons whose final colour is the accent itself.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-hot-to-neutral-cool`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
