---
id: shot-cloner-depth-echo
kind: technique
summary: "When one item stands for many (scale, batch, tenants): a card is copied into fading echoes in depth, then pulled back."
categories: [saas-app-launch, product-launch-film, tech-review, brand-story-corporate, animated-explainer]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, set_clip_properties_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [confident, technical, scaled]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-counter, T062, T002]
avoid_with: [kinetic-echo-stack, shot-stack-press-count]
needs: [parallax-camera-rig]
---

# Cloner depth echo

## What it is
A main card is "photocopied" into 6-7 translucent clones that line up behind it in depth along a diagonal, each smaller and
fainter than the one before. A beat of hold lets the viewer count them, then all of them are sucked back into the main
card, which bounces. Meaning: scale, not space. It is the same content repeated (unlike a parallax of different layers).

## Build it in Zenvi
No clone tool: stack the same clip on several tracks and keyframe each (verified recipe, 4 s, 16:9):
1. Background: `add_motion_block_tool {"block": "gradient_field", "placement": "full_frame", "track": 1, "duration_seconds": 4, "params": {"palette": "dark"}}`.
2. The card is any clip or motion-block render, scaled to 0.5. Place the same file on tracks 2-7 (farthest clone lowest) and the
   real card on track 8: `add_clip_to_timeline_tool {"file_id": "<card>", "position_seconds": 0, "duration_seconds": 4, "track": "<n>"}`;
   mute each (`set_clip_properties_tool {"timeline_clip_ids": ["<id>"], "properties": {"volume": 0}}`).
3. Clone `i` (1 = nearest): pop-out window starts at `t0 = 0.5 + 0.073*(i-1)` (2.2 f stagger), runs 0.27 s with
   `ease_out_back`; `set_keyframes_tool` on `scale_x` and `scale_y` from 0.5 to `0.5*0.9^i`, `location_x` 0 to `-0.05*i`,
   `location_y` 0 to `-0.045*i`, `alpha` 0 to `1 - 0.12*i` (so 88 % down to 28 %); hold to 2.5 s; return to the start values
   over 0.33 s with `ease_in_cubic` (alpha to 0).
4. Main card: `scale_x`/`scale_y` 0.5 holding, then 0.5 to 0.53 at 2.83-2.98 s (`ease_out_quad`), back to 0.5 by 3.2 s.
5. Sound: `add_sfx_tool` `pop` per clone at the pop-out times (-20 to -15 dB, new seed each), `whoosh_rise` at 2.83 s (-16 dB),
   `impact_thud` at 2.85 s (-14 dB).
Not possible: a true perspective vanishing point or depth blur on the far clones (`needs: parallax-camera-rig`); the scale
and alpha ladder carries the depth. The verified run used a `location_x` step of -0.07 and the farthest clone reached the
frame edge; -0.05 keeps all of them inside.

## Timing & taste rules
- 7 clones at 250 px spacing in the original; fewer than 5 does not read as a queue, more than 9 smears. Use 6.
- Spread staggered (2.2 f apart: a photocopier), pull-back synchronous (10 f): the asymmetry is deliberate.
- Hold about 1 s (32 f) so the viewer can count; add a 2 % push-in on the stack during the hold so it is not a dead frame.
- Clones keep only outline and header; do not repeat a big number on each clone, they turn into noise.
- Merge needs a bounce (1.06x on the main card): pulling back without a bounce reads as a fade-out.

## Sound for it
A tiny `pop` per clone, rising `whoosh_rise` on the pull-back, one solid `impact_thud` on the merge.

## Common mistakes
- Clones drawn behind the card in the wrong order (nearest clone must be on the highest track).
- Vanishing point at the centre: clones hide behind the main card. Push them to one corner.
- Static queue left on screen: it must end in the pull-back, not a hold on a lineup.
- Starting with the clones already visible (the copy-out is the idea).

## Verified
2026-10-29, CLI on bench footage (pexels_17197595): scripts/shot-cloner-depth-echo.sh → shots/shot-cloner-depth-echo.mp4 (local only). Checked on the sheet: six fading copies fan up-left behind the card at 0.5-0.9 s, hold, then all return and the card bounces by 3.2 s; the far clones reach the frame edge at -0.07 per step. Watch judge (absolute): **5.6/10**; main note: "The multi-card fanout and snap-back motion is clean and matches the isolated technique prompt well. However, the background blur styling feels generic and the animation settles quite abruptly."

Adapted from video-shotcraft card `shots/ui-entrance/cloner-depth-echo.md` (Apache-2.0; see ../NOTICE).
