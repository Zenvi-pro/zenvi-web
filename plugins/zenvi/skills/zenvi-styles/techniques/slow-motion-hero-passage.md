---
id: slow-motion-hero-passage
kind: technique
summary: "When one moment must feel luxurious (a pour, a jump apex, a portrait): 25-50% speed for 3-12 s, then snap back."
categories: [food-recipe, gaming-montage, sports-hype-edit]
tools: [set_clip_speed_tool, speed_ramp_tool, apply_fx_tool, set_keyframes_tool, add_sfx_tool, duck_tool]
pace: calm
mood: [luxurious, sensual, cinematic]
aspect: ["9:16", "16:9", "4:5", "1:1"]
pairs_with: [soft-bloom-lifted-shadow-grade, cut-on-action, voice-over-bed-mix-balance]
avoid_with: [accelerating-cut-length-ramp, sentence-split-rapid-hook]
needs: []
---

# Slow-motion hero passage

## What it is
The best moment (olive oil ribboning onto bread, the apex of a jump, a slow
push into a face) plays at 25-50 % for several seconds between normal-speed
shots, then the edit snaps back to speed on a cut and a hit.

## Build it in Zenvi
1. Place the hero shot with a short source range (1.5-2 s of source becomes
   3.75-5 s at 0.4x), then `set_clip_speed_tool {"timeline_clip_ids": ["<hero>"],
   "speed": 0.4}`. The receipt has the new `position` and `durationFrames`:
   place the next shot at that end (the clip after it does not move by itself;
   `ripple: true` on a full track was not enough in the test and left black).
2. Or shape it: `speed_ramp_tool {"clip_id", "preset": "ramp_out"}` (normal, then
   slows into the last frame) or `"hero"` (normal, held slow, normal).
3. Smooth frames from 24/30 fps sources (CLI/local only): `apply_fx_tool`
   `optical_flow_slowmo`.
4. A slow push over the hero: `set_keyframes_tool` scale 1.0 to 1.08-1.15.
5. The snap back: hard cut to the next normal-speed shot +
   `add_sfx_tool {"recipe": "hit_transient", "gain_db": -14}` on the cut.

## Timing & taste rules
- 0.25-0.5x; 3-12 s; once per piece (twice in 60 s at most).
- Liquids, hair, fabric, sparks and faces slow beautifully; walking does not.
- Sources at 50+ fps; at 30 fps keep 0.4x or faster unless optical flow is used.

## Sound for it
Thin the music (`duck_tool` or a dip) under the slow passage; one sustained
sweetener or real liquid sound; the hit on the return.

## Common mistakes
- Black gap after slowing a clip in the middle of a track (seen in the test).
- Slow motion with no sound change: the time stretch must be heard.
- A dirty phone-shot neighbour next to a clean hero: grade them together.

## Verified
2026-10-28: 7 s test, chop (normal) → olive-oil pour 1.8 s source at 0.4x
(4.5 s) → chop, hit on the return, acoustic bed. First render left 2 s of black
(the following clip did not ripple); fixed by placing the next shot at the
receipt's end. Contact sheet: pour ribbons slowly, clean return. Watch judge
overall 2.91: wanted a sound accent on the slow passage and a grade match
between the phone chop and the studio pour.
