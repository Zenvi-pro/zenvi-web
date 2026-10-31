---
id: cin-le-stage-clears-to-brand
kind: technique
summary: "When the last shot is the product: it leaves the stage and the brand, waiting behind it, reveals as it clears."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_kinetic_title_tool, apply_fx_tool, add_sfx_tool]
pace: medium
mood: [uncovering, clean]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, shot-ui-strip-away-outro]
avoid_with: [cin-le-device-becomes-mark]
needs: []
drawn: cinetic
---

# The product clears the stage

cinetic `le-stage-clears-to-brand` · Logo and end card · workhorse · energy any · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The last product element leaves (dropping out of frame, accelerating away, or bursting outward toward camera), and the brand, already waiting behind it, starts its reveal on the exact frame it is uncovered.

Use when: Walkthroughs and feature films whose last shot is the product itself. The opening was a window or card entering, so the reverse bookends it. A crescendo of many screens that should give way to calm.

## Build it in Zenvi

1. Brand layer under the product from the start: `add_clip_to_timeline_tool {"file_id": "<logo>", "position_seconds": 4.0, "duration_seconds": 4.0, "track": "2"}` on the stage colour, the product screen on `track 3` above it.
2. Exit one of three ways. Drop (44 f, 0.73 s, about 1000 px): `set_keyframes_tool {"timeline_clip_id": "<product>", "property": "location_y", "ease": "ease_in_out_sine", "points": [{"seconds": 4.0, "value": 0}, {"seconds": 4.73, "value": 0.93}]}`. Float-out: `location_y` -0.05 and `scale_x/y` 1 to 1.33 over 25 f (0.42 s) `ease_in_cubic`. Burst of a card cluster: each card `location` 300-450 px outward, `scale` 1 to 3 over 20 f (0.33 s) `ease_in_cubic`, removed at about 75 px/f.
3. Blur the fast frames: `apply_fx_tool {"clip_id": "<product>", "effects": [{"effect": "directional_blur", "amount": 0.7, "start": 4.2, "end": 4.73}]}`.
4. Start the brand reveal on the frame the product's edge clears the lockup box (computed from the exit curve, say 4.55 s): mark `scale_x/y` 0.48 to 1 over 68 f (1.13 s) `ease_out_expo`, or `add_kinetic_title_tool {"text": "ZENVI", "style": "documentary", "animation": "fade", "position_seconds": 4.55, "duration_seconds": 3.5}` fading up over 40 f (0.67 s) with no scale.
5. `add_sfx_tool {"recipe": "whoosh_fall", "at_seconds": 4.0, "gain_db": -12}`.

## Timing & taste rules

- cinetic's timing (60 fps): Drop: 44 f (0.73 s) on ease_in_out_sine (~1000 px, peak ~64 px/f, motion-blur pass on). Float-out: 25 f (0.42 s) on ease_in_cubic (5 -> 22 px/f, scale +33%). Burst: 20 f (0.33 s) on ease_in_cubic, cut at ~75 px/f. The brand reveal starts within 0-1 f (0.02 s) of the clear frame. Mark growth: 68 f (1.13 s) on ease_out_expo (edge speed ~17 px/f, no overshoot). Then hold 90-120 f (2.00 s) under a 10-15% push (le-living-hold).
- Drop 44 f (0.73 s) ease_in_out_sine, peak about 64 px/f with motion blur; float-out 25 f (0.42 s) ease_in_cubic, 5 to 22 px/f, scale +33 %; burst 20 f (0.33 s) cut at about 75 px/f.
- The brand reveal starts within 0-1 f of the clear frame.
- Mark growth 68 f (1.13 s) ease_out_expo, edge speed about 17 px/f, no overshoot; or a 0.08 em letterspaced wordmark fades up over 40 f (0.67 s).
- Hold 90-120 f (1.5-2 s) under a 10-15 % push.

## Sound for it

A falling whoosh on the exit; the music cuts to near-silence at the cleared frame and one hit lands on the reveal.

## Common mistakes

- The last beat is type, not product.
- A lockup that is already visible would be crossed by the exiting product.
- A burst with no energy built earlier to justify it.
- Avoid when: The film's last beat is type, not product. A lockup that is already visible would be crossed by the exiting product. A burst with no build-up earlier to justify the energy.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-stage-clears-to-brand`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
