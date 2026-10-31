---
id: shot-match-iris-window
kind: technique
summary: "When a round element or card should become the next scene: an iris or window opens from it, the new scene grows inside."
categories: [saas-app-launch, product-launch-film, tech-review, flash-cut-match-cut-edit, brand-story-corporate]
tools: [add_shape_mask_tool, set_keyframes_tool, add_clip_to_timeline_tool, add_track_tool, add_sfx_tool]
pace: medium
mood: [smooth, graphic, purposeful]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-match-on-action, kinetic-counter, kinetic-stencil-reveal]
avoid_with: [shot-hidden-cut-masks, shot-ink-bleed-reveal, shot-solid-page-wipes]
needs: []
---

# Match iris / portal window

## What it is
The cut has an anchor: a real round element (avatar, icon, dial) in the old scene is where an iris opens; inside it the
new scene grows, with its own round form (a donut chart, a ring) landing on the same circle. Variant: a card enlarges into
a full-screen window and the new scene grows inside it. The viewer sees "this circle became that circle", or "I opened
this card".

## Build it in Zenvi
1. Old scene on track 1; the new scene on a track above, starting where the iris begins:
   `add_clip_to_timeline_tool {"file_id": "<A>", "start_seconds": 4, "duration_seconds": 4.2, "position_seconds": 0, "track": "1"}`,
   `add_track_tool {"name": "Over"}`, `add_clip_to_timeline_tool {"file_id": "<B>", "start_seconds": 0.5, "duration_seconds": 2.6,
   "position_seconds": 1.6, "track": "2"}`.
2. The iris on the new scene, centred on the anchor (measure it from a still frame; use the content circle, not the padded
   box): `add_shape_mask_tool {"clip_ids": ["<B>"], "shape": "ellipse", "x": 0.30, "y": 0.38, "width": 1.0, "height": 1.78,
   "feather": 0.004, "keyframes": [{"seconds": 1.6, "grow": -1}, {"seconds": 1.9, "grow": -0.85}, {"seconds": 2.9, "grow": 0.6}]}`
   (width 1.0 x height 1.78 is a circle on 16:9; keyframe `seconds` are timeline seconds; grow +0.6 runs the circle past
   the far corner). Window variant: `shape: "rectangle"`, centred on the card, same keyframes, with the new scene's own
   `scale_x` / `scale_y` going 0.42 to 1 on the same curve (counter-scaling, "the world grows inside").
3. The old scene pushes back as the circle opens: `set_keyframes_tool` `scale_x` and `scale_y` on A, 1.0 to 1.03 (at 1.6 s) then
   1.22 (at 2.9 s) `ease_in`; `alpha` 1 to 0.45 over the same time.
4. `add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 2.4, "gain_db": -14}` and `{"recipe": "impact_punch", "at_seconds": 2.9, "gain_db": -14}`.

## Timing & taste rules
- The anchor and the opening share one centre: 10 px off is visible at once.
- Lead the eye first: dim other rows to about 32 %, pulse the anchor twice (1 to 1.16), then open. Without it nobody finds the centre.
- Open over about 30 f (1 s) with a slow-fast-slow curve; under 20 f the shape match is lost.
- Old scene scales 1.03 to 1.22 and darkens to 0.45 while it opens, or the new scene looks like a sticker.
- Pair by meaning (avatar to that person's data); the anchor must be a true circle, not a rounded square.
- Everything inside the opening grows with the opening; no extra entrance animations in the new scene.
- One transition per join; a flash or shake on top is a mistake.

## Sound for it
A rising `whoosh_rise` (-14 dB) into the opening and a soft `impact_punch` at full open.

## Common mistakes
- Opening centre measured from the screenshot's box, not the visual circle.
- Same iris used for unrelated scenes (circle with no meaning).
- A tween so fast that the circle is only seen for 3 frames (the first try here opened over 0.2 s).

## Verified
2026-10-29, CLI on bench footage (`pexels_5528003` then `pexels_4465902`): scripts/shot-match-iris-window.sh → shots/shot-match-iris-window.mp4 (local only). Checked on frames: the circle opens centred on the speaker's head, grows past the corner in about 1 s, the old scene dims; the first version opened in 0.2 s, fixed by slowing the keyframes. Watch judge (absolute): **3.0/10**; main note: "executed without proper easing or visual motivation ... feels like a basic circular mask overlay" (the footage has no round element; the test is the mask and the timing).

Adapted from video-shotcraft cards `shots/transition/circle-match-iris.md` and `shots/transition/shot-transitions.md` (portal wipe) (Apache-2.0; see ../NOTICE).
