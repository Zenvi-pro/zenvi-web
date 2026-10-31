---
id: cin-tr-motion-masked-swap
kind: technique
summary: "When copy changes inside a continuous scene: swap the content on the exact frame a bigger move peaks."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, apply_motion_transition_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [seamless, dynamic, loopable]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-tr-velocity-handoff-cut, shot-hidden-cut-masks, kinetic-keyword-slam]
avoid_with: [kinetic-counter, cin-tr-defocus-cut]
needs: []
drawn: cinetic
---

# Motion-masked swap

cinetic `tr-motion-masked-swap` · Transition · workhorse · energy medium · formats feature, loop, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Content changes on exactly the frame something else moves fastest (background rings whipping past, a card kicking into a tilt), so the change hides inside the motion and two states chain in one space with no visible cut.

Use when: Changing copy inside a continuous environment; cycling examples (photos, prompts, results) in a loop.

## Build it in Zenvi

1. Content A and B as two clips, the cut at the swap frame `s`.
2. Kick the card into a tilt on the swap frame: `apply_motion_transition_tool {"preset": "tilt", "clip1_id": "<A>", "clip2_id": "<B>", "direction": "up", "duration": 0.37, "intensity": 0.6}` so the peak of the move lands on `s` (centre it on the cut); or `{"preset": "squash", "direction": "left"}` for a card kick.
3. Or run a big background sweep (rings, a band) on a separate track, `set_keyframes_tool {"timeline_clip_id": "<sweep>", "property": "location_x", "mode": "replace", "points": [{"seconds": <s-0.18>, "value": -0.8}, {"seconds": <s+0.18>, "value": 0.8, "ease": "ease_in_out_sine"}]}` over 20-24 f (0.33-0.4 s) from s-11 f to s+11 f (0.18 s each side), peak speed on `s`.
4. Give B its own arrival from `s`: a slam or word reveal, `add_kinetic_title_tool {"text": "...", "animation": "slam", "position_seconds": <s>}`.
5. Give a kicked card a soft shadow so the tilt reads. Repeat no faster than every 48-54 f (0.8-0.9 s). `add_sfx_tool {"recipe": "swoosh_hit", "at_seconds": <s>, "gain_db": -14}`.

Fallback: A true rotateY card kick needs a 3D scene; the tilt/squash presets are the nearest, and `add_3d_scene_tool {"scene": "cube_cut", "params": {"from_clip_id": "<outgoing clip>", "to_clip_id": "<incoming clip>"}}` gives a real turn.

## Timing & taste rules

- cinetic's timing (60 fps): Sweep: 20-24 f (0.40 s) on ease_in_out_sine, centred on the swap. Kick: attack 2 f (0.03 s), decay tau 3 f (0.05 s), settled in about 8 f (0.13 s). Repeat no faster than every 48-54 f (0.90 s).
- Sweep 20-24 f (0.33-0.4 s) on a smooth ease, centred on the swap.
- Kick: attack 2 f (0.03 s), decay tau 3 f (0.05 s), settled in ~8 f (0.13 s); tilt about 12 degrees, skew 2.
- The masking motion must peak above ~20 px/f at its peak or the swap shows.
- Repeat no faster than every 48-54 f (0.8-0.9 s).
- The new content gets its own arrival from the swap frame.

## Sound for it

A `swoosh_hit` on the swap frame, softer than a cut sound; the move carries the sound.

## Common mistakes

- A weak masking motion (under ~20 px/f), so the swap shows; or a counter, which should roll instead (avoid_when).
- Swapping on a frame other than the motion peak.
- Repeating faster than every ~0.8 s.
- Avoid when: The masking motion is weak (under about 20 px/f at its peak), so the swap shows; or the content is a counter (roll the digits instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-motion-masked-swap`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
