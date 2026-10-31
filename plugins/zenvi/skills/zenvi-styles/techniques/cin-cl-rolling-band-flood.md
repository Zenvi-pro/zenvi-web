---
id: cin-cl-rolling-band-flood
kind: technique
summary: "When a light product act ends in the brand end card: bands of the brand colour roll up and flood the frame, no cut."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [closing, fluid, brand]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-accent-claim-grounds, shot-ui-to-brand-morph, shot-brand-ink-open]
avoid_with: [cin-cl-light-swell-bridge, cin-cl-inversion-card]
needs: []
drawn: cinetic
---

# Rolling band flood

cinetic `cl-rolling-band-flood` · Colour and light · signature · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A light frame fills with the brand colour as soft horizontal bands of it roll upward and grow opaque. The text tints and dissolves into it, and the film arrives on its end-card field without a cut.

Use when: Closing a light product act into the end card, or returning to the brand world after the last UI beat (a success state, a published page) without a hard cut.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same last frame and title as in the full build.
2. Flood only from tonal steps of one non-banned hue (light tint, mid tint, the accent): `add_motion_block_tool {"block": "gradient_field", "position_seconds": 6.0, "duration_seconds": 5, "params": {"style": "aurora", "colors": ["<tint_70>", "<tint_45>", "<accent>"], "speed": 0.8}, "track": "2"}`.
3. Keep the squared opacity ramp (0 to 0.25 at 6.5 s to 1 at 7.0 s), the text absorption (fade 6.2-6.67 s) and the slow end-card drift.

**Full look** (relies on gradient, orange, purple: only when the person's brand supplies that look):

1. Last product frame with its text, e.g. `add_kinetic_title_tool {"text": "Published.", "style": "editorial", "animation": "rise", "ink": "#141414", "background": "#fafafa", "position_seconds": 6.0, "duration_seconds": 1.7}`.
2. The flood on a track above: `add_motion_block_tool {"block": "gradient_field", "position_seconds": 6.0, "duration_seconds": 5, "params": {"style": "aurora", "colors": ["<tint_70>", "<tint_45>", "<tint_20>", "<accent>"], "speed": 0.8, "grain": false}, "track": "2"}`.
3. Colour arrives late and decisively, opacity following progress squared over 60 f (1.0 s): `set_keyframes_tool {"timeline_clip_id": "<flood>", "property": "alpha", "ease": "linear", "points": [{"seconds": 6.0, "value": 0}, {"seconds": 6.5, "value": 0.25}, {"seconds": 7.0, "value": 1}]}`.
4. The text is absorbed, not covered: fade the title over f12-f40 (6.2-6.67 s): `set_keyframes_tool {"timeline_clip_id": "<text>", "property": "alpha", "points": [{"seconds": 6.2, "value": 1}, {"seconds": 6.67, "value": 0, "ease": "ease_in_out_sine"}]}`.
5. End card on the same field: a second slower field `add_motion_block_tool {"block": "gradient_field", "position_seconds": 7.0, "duration_seconds": 3, "params": {"style": "aurora", "colors": ["<tint_70>", "<tint_45>", "<tint_20>", "<accent>"], "speed": 0.1}, "track": "2"}`, then `add_kinetic_title_tool {"text": "zenvi.pro", "style": "editorial", "animation": "rise", "ink": "#ffffff", "position_seconds": 7.3, "duration_seconds": 2.7}`.
6. `add_sfx_tool {"recipe": "riser_noise", "at_seconds": 6.0, "duration": 1.0, "gain_db": -18}`.

Fallback: The aurora's bands are wide and soft but not the exact six tonal bands rolling at 18 px per frame; expect a looser roll. The text mix toward an accent tone is skipped (it fades instead).

## Timing & taste rules

- cinetic's timing (60 fps): 60 f (1.00 s) in total. The bands roll one frame height on linear (about 18 px/f at 1080p), and the opacity follows p^2 over the same 60 f (1.00 s). The text tints over 12 f (0.20 s) and fades over f12 (0.20 s)-f40 (0.67 s) on ease_in_out_sine. Frame mean luma goes from about 250 to 215: a light-to-mid flood, not a polarity flip. The bands then ease to a 0.3 px/f drift for the end card's 90-120 f (2.00 s).
- 60 f (1.0 s) in total; the bands roll one frame height at constant speed (about 18 px per frame at 1080p).
- Opacity follows progress squared: a quarter strength at the halfway point.
- Mean luma goes from about 250 to 215: a light-to-mid flood, not a polarity flip.
- Text fades over f12-f40 (0.2-0.67 s, ease_in_out_sine); the bands then ease to a 0.3 px per frame drift for the end card's 90-120 f (1.5-2.0 s).
- Once per film, before an end card whose ground is the same hue.

## Sound for it

A faint riser under the flood, nothing on the lockup; the end card is quiet.

## Common mistakes

- Dark films, where the flood reads as fog over black.
- A second flood in the same film, or one before an end card of a different hue.
- A multi-hue spectrum of bands on a brand that bans gradients; use the one-hue variant.
- Avoid when: Dark films, where the flood reads as fog over black. Also avoid it a second time in the same film, and before an end card whose ground is not the flood's hue.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-rolling-band-flood`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
