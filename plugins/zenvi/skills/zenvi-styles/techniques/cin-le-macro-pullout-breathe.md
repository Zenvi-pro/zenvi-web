---
id: cin-le-macro-pullout-breathe
kind: technique
summary: "When the mark first appears at the end: it starts so huge only fragments show, undershoots, then breathes to rest."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [grand, settling]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, cin-le-hot-to-neutral-cool]
avoid_with: [cin-le-slam-spin-pullout, t110]
needs: [true-motion-blur-native]
drawn: cinetic
---

# Pull out of the mark, undershoot, breathe

cinetic `le-macro-pullout-breathe` · Logo and end card · signature · energy high · formats launch, sting, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The mark arrives so large that only fragments of it fill the frame, collapses to slightly smaller than its final size, then gently breathes up to rest, as if the camera had found it.

Use when: The mark's first full appearance at the end, or a logo sting. A hit after a short bass gap. Marks with a strong silhouette or inner shapes that read as abstract fragments when huge.

## Build it in Zenvi

1. The mark at its final spot (about 80 px, 0.04 of width, left of centre when a name follows): `add_clip_to_timeline_tool {"file_id": "<logo>", "position_seconds": 6.0, "duration_seconds": 4.0, "track": "3"}`.
2. Collapse in log space from about 5x (outer edge about 750 px from the centre): `set_keyframes_tool {"timeline_clip_id": "<logo>", "property": "scale_x", "points": [{"seconds": 6.0, "value": 5.0}, {"seconds": 6.58, "value": 1.0, "ease": "ease_out_expo"}, {"seconds": 6.87, "value": 0.94, "ease": "ease_in_out_sine"}, {"seconds": 7.2, "value": 1.0, "ease": "ease_in_out_sine"}]}` (same on `scale_y`; 72 f, 1.2 s, bottom of the undershoot near f52, 0.87 s).
3. Blur the fast frames: `apply_fx_tool {"clip_id": "<logo>", "effects": [{"effect": "radial_blur", "amount": 0.8, "start": 0, "end": 0.4}]}`.
4. Enter on a cut: the outgoing shot shrinks into its centre over its last 24 f (0.4 s), `scale_x/y` 1.0 to 0.5 `ease_in_cubic`, then the cut.
5. Put the bottom of the undershoot on the strongest low hit after a ~15 f (0.25 s) bass gap: `add_sfx_tool {"recipe": "sub_drop", "at_seconds": 6.87, "gain_db": -8}`.

Fallback: Native motion blur on a scaled logo is not available; radial_blur on the first 0.4 s is the stand-in.

## Timing & taste rules

- cinetic's timing (60 fps): Collapse: N = 43 x ln(s0 / 0.93) frames on ease_out_cubic (72 f (1.20 s) from 5x; log rate about 0.105/f at the start, outer edge under about 80 px/f, under 0.07/f by f10 (0.17 s)). Breathe: the last 24 f (0.40 s) on ease_in_out_sine (0.93 -> 1.0), bottoming at 0.94 near f52 (0.87 s). Settled by f72 (1.20 s). Hold the mark ~20 f (0.33 s) before the name follows.
- Start scale about 5x for a 300 px mark; collapse N = 43 x ln(s0 / 0.93) f, 72 f (1.2 s) from 5x, outer edge under about 80 px/f.
- Crosses 1.0 near f35 (0.58 s), bottoms near 0.94 at f52 (0.87 s), rests at 1.0 by f72 (1.2 s) with no velocity step.
- Hold the mark about 20 f (0.33 s) before the name follows.
- Keep counters and small parts outside the frame until the log rate falls below 0.07/f (~f10, 0.17 s).

## Sound for it

A sub_drop at the bottom of the undershoot after a short bass gap; the music cut belongs to the end card.

## Common mistakes

- Thin line marks: at macro scale they become two hairlines.
- Right after another zoom-through seam.
- A mark already shown at hero size earlier: this is a replayed reveal.
- Avoid when: Thin line marks (at macro scale they become two hairlines crossing the frame). Right after another zoom-through seam. The mark was already shown at hero size earlier (that makes this a replayed reveal).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-macro-pullout-breathe`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
