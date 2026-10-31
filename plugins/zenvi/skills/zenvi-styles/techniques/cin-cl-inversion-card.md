---
id: cin-cl-inversion-card
kind: technique
summary: "When one promise in a dark film must stop the viewer: a one-second near-white card with dark type at about 40 % in."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, add_guide_overlay_tool, set_keyframes_tool]
pace: medium
mood: [stark, decisive, clean]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [blackout-and-dead-silence-pause, cin-cl-accent-claim-grounds, kcut-flood-climax]
avoid_with: [cin-cl-rising-wash-carrier, cin-cl-light-swell-bridge]
needs: [soft-colour-falloff-ring]
drawn: cinetic
---

# Single inversion card

cinetic `cl-inversion-card` · Colour and light · signature · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

In an otherwise dark film, one card cuts to a near-white field with dark type for one second, marking the key promise.

Use when: A dark film's single most important promise needs to stop the viewer halfway through.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same cut and timing, but neutral paper, never cream: `add_kinetic_title_tool {"text": "No more busywork.", "style": "editorial", "animation": "rise", "ink": "#141414", "background": "#f5f5f5", "position_seconds": 12.0, "duration_seconds": 1.0}`.
2. One hard-edged accent stroke, 6-10 px, ellipse at 88 % of the frame: `add_guide_overlay_tool {"kind": "ring", "clip_id": "<card_clip>", "box": {"x": 0.5, "y": 0.5, "width": 0.88, "height": 0.88}, "color": "<accent>", "stroke_width": 8, "start": 12.0, "duration": 1.0}`.
3. Breathe it in scale only (1.00-1.02 over 2 s, `scale_x`/`scale_y` keyframes, ease_in_out_sine). No colour falloff and no second hue.

**Full look** (relies on gradient, beige: only when the person's brand supplies that look):

1. Hard-cut, inside a gap in the music at about 40 % of the runtime (e.g. 12 s of 30): `add_kinetic_title_tool {"text": "No more busywork.", "style": "editorial", "animation": "rise", "ink": "#141414", "background": "#f2e9d6", "position_seconds": 12.0, "duration_seconds": 1.0}`. The title rises out of a line over 18 f (0.3 s) starting f4 (0.07 s).
2. Soft ring of two accent hues at the edge: `add_guide_overlay_tool {"kind": "ring", "clip_id": "<card_clip>", "box": {"x": 0.5, "y": 0.5, "width": 0.9, "height": 0.9}, "color": "<accent>", "stroke_width": 14, "start": 12.0, "duration": 1.0}` (only one stroke colour; see fallback).
3. Breathe the ring: `set_keyframes_tool {"timeline_clip_id": "<ring_clip>", "property": "scale_x", "points": [{"seconds": 12.0, "value": 1.0}, {"seconds": 12.5, "value": 1.02, "ease": "ease_in_out_sine"}, {"seconds": 13.0, "value": 1.0, "ease": "ease_in_out_sine"}]}` and the same on `scale_y` (period 120 f = 2 s, plus/minus 2 %).
4. Cut out hard on the next beat; this is the only light frame in the film (mean luma jumps from about 9 to about 232).

Fallback: No feathered two-hue falloff ring exists; the ring is one hard stroke in one accent colour (this is also the ban-safe look).

## Timing & taste rules

- cinetic's timing (60 fps): Hold for 60 f (1.00 s). The type rises over 18 f (0.30 s) on ease_out_expo, starting on f4 (0.07 s). The ring breathes with a period of 120 f (2.00 s), ±2%. Place it at about 40% of runtime.
- Hold 60 f (1.0 s); type rises over 18 f (0.3 s, ease_out_expo) from f4.
- Place it at about 40 % of runtime, inside a music gap.
- The ring breathes 1.00-1.02 on a 120 f (2 s) period.
- It must be the film's only light frame; cut out hard, no fade.

## Sound for it

Let the music gap carry it; at most one low `impact_thud` (-14 dB) when the type lands. No whoosh into the card.

## Common mistakes

- Using it in a light-mode film or one that already alternates dark and light.
- Placing it where the music has no gap to land in.
- Fading in or out of the card; it is a hard cut both ways.
- Avoid when: Light-mode films, films that already alternate dark and light, or when the music has no gap to place it in.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-inversion-card`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
