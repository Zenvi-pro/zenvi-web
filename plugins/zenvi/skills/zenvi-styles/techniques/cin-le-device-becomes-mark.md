---
id: cin-le-device-becomes-mark
kind: technique
summary: "When a film has a story object: its last frame lands exactly on the mark's position and size and the logo replaces it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [payoff, seamless]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, cin-le-mark-slide-name-follow, circular-problem-to-proof-bookend]
avoid_with: [cin-le-stage-clears-to-brand]
needs: []
drawn: cinetic
---

# Story object becomes the mark

cinetic `le-device-becomes-mark` · Logo and end card · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The film's last object (a dot, circle, coin or pill) ends at exactly the mark's screen position and size, and the mark replaces it by a hard cut or an in-place morph, so the logo arrives as the answer to the story.

Use when: Every film that has a story device: the default way to arrive at the mark, especially as the device's third and final use.

## Build it in Zenvi

1. Decide the mark's final rect first (centre, size, radius, colour), then drive the story object so its last frame lands on it: `set_keyframes_tool {"timeline_clip_id": "<object>", "property": "location_y", "ease": "ease_out_expo", "points": [{"seconds": 4.0, "value": 0.2}, {"seconds": 4.37, "value": 0}]}` (a coin rising 20 % of height over 22 f, 0.37 s) with `scale_x` matching the mark; for a coin turn, `rotation` is not enough, so end on the face-on frame.
2. Variant: a pill hugging a deleting word: `add_kinetic_title_tool {"text": "...", "animation": "typewriter"}` states cut from both ends every 5 f (0.08 s) while a pill clip's `scale_x` eases down to the circle.
3. Hard-cut to the flat mark at exactly the object's last position and 0.57 of the rect: `add_clip_to_timeline_tool {"file_id": "<logo>", "position_seconds": 4.37, "duration_seconds": 3.0, "track": "3"}` with `scale_x/y` 0.57 to 1 over 18 f (0.3 s) `ease_out_expo`, half the growth in the first 2 f, no overshoot.
4. Or finish in place: darken the dot to the mark's ink and fade the glyph in over the last 4 f (0.07 s) using two aligned clips and `alpha` keyframes over 12 f (0.2 s).
5. Hold about 20 f (0.33 s) before the name follows: `add_sfx_tool {"recipe": "hit_transient", "at_seconds": 4.37, "gain_db": -12}`.

## Timing & taste rules

- cinetic's timing (60 fps): Coin flip: 22 f (0.37 s) on ease_out_cubic. Two-ended delete: 5 f (0.08 s) per letter pair, pill width eased 4 f (0.07 s) per step on ease_in_out_cubic. Pill-to-square morph: 30-40 f (0.67 s) on ease_in_out_expo. Cut pop: 18 f (0.30 s) on ease_out_expo (0.57 -> 1). In-place darkening: 12 f (0.20 s). Then hold ~20 f (0.33 s) before the name follows.
- Coin flip 22 f (0.37 s) ease_out_expo; two-ended delete 5 f (0.08 s) per letter pair; pill-to-square morph 30-40 f (0.5-0.67 s) ease_in_out_sine.
- Cut pop 18 f (0.3 s) from 0.57 to 1, no overshoot; in-place darkening 12 f (0.2 s).
- Centre, size, radius and colour match across the seam; nothing may blink, double or change style, not even for one frame.
- Hold about 20 f (0.33 s) before the name follows.

## Sound for it

One hit_transient on the swap frame; the object's own last sound ends before it.

## Common mistakes

- No recurring object in the film: a mark forced out of an unrelated shape reads as a pun.
- Object and mark shapes disagree (a square into a circle needs a morph, never a cut).
- Any one-frame blink or style change at the seam.
- Avoid when: There is no recurring object (a mark forced out of an unrelated shape reads as a pun). The object's shape and the mark's disagree (a square into a circle needs a morph, never a cut).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-device-becomes-mark`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
