---
id: cin-tr-subtract-reveal
kind: technique
summary: "When a busy montage should end on one thing: the clutter flies off and uncovers the hero sitting behind it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [revealing, tidy, punchy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-pullback-isolation, big-number-lockup-and-counter, kcut-collapse-cut]
avoid_with: [cin-tr-cover-wipe, shot-card-flock-tumble]
needs: []
drawn: cinetic
---

# Reveal by subtraction

cinetic `tr-subtract-reveal` · Transition · workhorse · energy medium · formats launch, feature, walkthrough, sting, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The clutter in front of the hero flies off toward the frame edges or shrinks away, uncovering a hero that was already sitting at its final size behind it.

Use when: Ending a busy montage on the one stat, card or word. Walkthroughs that change app areas through the product's own window behaviour.

## Build it in Zenvi

1. The hero sits on track 1, static, already at its final size and position (a counter block, card or word): e.g. `add_motion_block_tool {"block": "counter", "position_seconds": 0, "duration_seconds": 3, "params": {"values": ["98.6"], "suffix": "%"}}`.
2. Clutter items (cards, chips, screens) on tracks 2..N, each a clip placed over the hero. Each moves along the vector from the hero's centre through its own centre, travel scaled by (1 + index x 0.1): `set_keyframes_tool {"timeline_clip_id": "<item i>", "property": "location_x", "mode": "replace", "points": [{"seconds": <T>, "value": 0}, {"seconds": <T+0.5>, "value": <dx_i>, "ease": "ease_in_out_expo"}]}` and `location_y` with `<dy_i>`, where `dx, dy` is twice the item's distance to clear the frame (so each stays under ~75 px/f).
3. Keep the clearing distance at or under 750 px by starting big cards near the edges. Stagger 0-2 f (0-0.03 s) between items; all items gone by f24 (0.4 s) of the 30 f (0.5 s) scatter.
4. Window variant: `scale_x/scale_y` 1.0 to 0.05 about the cursor corner with `origin_x`, `origin_y` set to that corner, 40 f (0.67 s, `ease_in_cubic`), `alpha` 1 to 0 over the last 6 f (0.1 s); the next panel enters 4 f (0.07 s) after it vanishes.
5. Staccato variant: delete one item every 5-7 f (0.08-0.12 s) with hard steps (constant interpolation), re-centring survivors, until one remains; hold 17 f (0.28 s).
6. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": <T>, "gain_db": -14}`.

## Timing & taste rules

- cinetic's timing (60 fps): Scatter: 30 f (0.50 s) on ease_in_cubic; items clear the frame by about frame 24; stagger 0-2 f (0.03 s); the hero stays static throughout. Window minimize: 40 f (0.67 s) on ease_in_cubic in log scale (far corner ≤ 75 px/f), fading over the last 6 f (0.10 s); next entrance 4 f (0.07 s) later. Staccato: one removal every 5-7 f (0.12 s), final hold 17 f (0.28 s).
- Scatter 30 f (0.5 s), items clear the frame by ~f24 (0.4 s); the hero stays static throughout.
- Travel = twice the distance to clear the frame, under ~75 px/f; stagger 0-2 f.
- Window minimize: 40 f (0.67 s) ease-in in log scale, fading over its last 6 f (0.1 s); next entrance 4 f later.
- Staccato: one removal every 5-7 f, final hold 17 f (0.28 s).
- The hero must be fully ready behind the clutter: it never pops in.

## Sound for it

One whoosh at the start of the scatter; optionally a tiny `pop` as the hero is left alone.

## Common mistakes

- The hero is not ready behind the clutter (it must never pop in), or the clutter is content the viewer has not finished reading (avoid_when).
- Different start frames for the hero: it is static from the first frame.
- Slow, linear scatter: it should accelerate off.
- Avoid when: The hero is not ready behind the clutter (it must never pop in), or the clutter is readable content the viewer has not finished.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-tr-subtract-reveal.mp4` (1280x720p60, counter motion block (98.6 %, 3 s) as the hero with four scaled-down cards on tracks 3-6 around it, each moving outward along the vector from the centre with location_x/location_y over 1.0-1.5 s on ease_in_out_expo (travel 1.6 x 1.1 frame units times 1 + 0.1 i), whoosh_short at 1.0 s): frames 0.95-1.6 s show the four cards flying to their corners and off the frame by about 1.33 s while the counter stays put and keeps counting; the window and staccato variants were not built; watch judge 5.8/10.

Found when rendering it (apply before building):

- Step 2: location_x/location_y points need the item's own base position as start (here -0.3/-0.25 and so on) and timeline_seconds; start the points with the hold at 0 (value base) and then T, otherwise the clip moves from the first keyframe; with the card base at the item's position the end value is base + outward vector (1.6 x 1.1 units cleared the frame from scale 0.3).
- Step 1: the counter block is placed over_video on track 2 by default and the clutter clips on tracks 3+; add_clip_to_timeline_tool with track 3..6 keeps them above the hero. Counters keep rolling after the scatter (it reads 98 % at 1.08 s), so start the scatter after the count ends if the hero must be still.
- Step 4: origin_x/origin_y cannot be keyframed (set_keyframes_tool refuses them); for the window variant scale about the corner with location compensation location = (1 - f) * (P - 0.5) per axis.

Translated from cinetic's technique library (`tr-subtract-reveal`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
