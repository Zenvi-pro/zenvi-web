---
id: screen-capture-zoom-onto-the-number
kind: technique
summary: "When proof is a metric on a screen: push in onto the number in 0.3-0.4 s with a swoosh, hold it 1 s."
categories: [ugc-ad-testimonial, vfx-tutorial-breakdown]
tools: [set_keyframes_tool, add_clip_to_timeline_tool, add_motion_block_tool, add_sfx_tool]
pace: fast
mood: [credible, punchy, informative]
aspect: ["9:16", "4:5", "1:1", "16:9"]
pairs_with: [ui-card-over-the-speaker, circular-problem-to-proof-bookend, slide-in-pill-badge-and-name-cards]
avoid_with: [slow-pan-over-stills-or-documents]
needs: [screen-recording-zoom-follow]
---

# Screen-capture zoom onto the number

## What it is
The screen recording or screenshot of the proof (views, comments, revenue)
holds for a beat, then the frame punches in onto the one number that matters
and holds it; 1.3-1.5 s per proof shot, a swoosh per push.

## Build it in Zenvi
1. Place the capture: `add_clip_to_timeline_tool {"file_id", "position_seconds",
   "duration_seconds": 4}` (images need `duration_seconds`).
2. Find the number's centre on a `preview_frame {"grid": true}`: (px, py), 0-1.
3. Zoom by `s` about the frame centre and offset so the number lands centre:
   `location_x = -s * (px - 0.5)`, `location_y = -s * (py - 0.5)`.
   For "286K" at (0.25, 0.27) with s 2.2: location_x 0.55, location_y 0.5.
   ```json
   set_keyframes_tool {"timeline_clip_id": "<c>", "property": "scale_x",
     "points": [{"seconds": 0.9, "value": 1.0, "ease": "ease_out_cubic"}, {"seconds": 1.3, "value": 2.2}, {"seconds": 4, "value": 2.3}]}
   ```
   same for `scale_y`, `location_x`, `location_y` with their values.
4. `add_sfx_tool` `whoosh_short` -16 on the push start, `pop` -16 on landing.
5. An outlined pill around the number: `add_motion_block_tool` `hud_callouts`
   over the video (approximate); auto-follow of a cursor or a UI region needs
   `screen-recording-zoom-follow`.

## Timing & taste rules
- Push 0.3-0.4 s with ease-out; hold the number 1-1.5 s with a 2-5 % drift
  (a dead freeze reads as a still: the judge's note).
- The number at 15-25 % frame height after the zoom; the source must be sharp
  at that scale (screenshots at device resolution, not a phone photo).
- 3 proof shots in a row at most.

## Sound for it
Swoosh on the push, a pop or tick on the landing at -16 dB; a riser under a
run of proofs.

## Common mistakes
- Positive `location_y` for a number in the upper half (moves the wrong way;
  the test's first push landed on the wrong card).
- Zooming a blurry capture.

## Verified
2026-10-28: 4 s test on an original drawn analytics screen (no real app UI),
push 1.0 → 2.2 at 0.9-1.3 s onto "286K", swoosh + pop. First push used the
wrong offset and landed between cards; fixed with the formula above. Watch judge
motion 5, overall 4.55; fix: drift during the hold, add a UI click.
