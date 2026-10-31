---
id: shot-lead-word-zoom-assemble
kind: technique
summary: "When one word must be read first: it fills the frame, then shrinks into the line while the other words are pushed in."
categories: [kinetic-type-motion-design, product-launch-film, brand-story-corporate, saas-app-launch, automotive-ad]
tools: [add_motion_block_tool, add_kinetic_title_tool, get_clip_properties_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [confident, launch, crisp]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-emphasis-scale, shot-title-demote-to-label, kinetic-mask-reveal]
avoid_with: [kinetic-word-pop, kinetic-beat-strobe, shot-type-assembly]
needs: [pivot-scale-keyframes]
---

# Lead word zoom, then assemble

## What it is
The first word of the line (a name, "Introducing") starts at 2.3x, centred, still creeping toward the viewer. Then one move
brings it back to its size and slides the line left into place while the rest of the words are pushed in from the right of
their slots. The viewer has read the lead word twice before the sentence exists. Opening title cards, launch lockups.

## Build it in Zenvi
Two native titles on one baseline (lead word, rest of the line), then keyframes on the lead word. A title is a full-frame
picture that scales from its top-left corner, so scaling it moves the word: compute the position that keeps the word's
centre where you want it (this is the missing `pivot-scale-keyframes`; the arithmetic below is the fallback).
```json
add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 3.4, "placement": "full_frame",
  "params": {"style": "orbs", "colors": ["#1b2350", "#3a2a5a", "#0e1020"], "speed": 0.4, "grain": true}}
add_kinetic_title_tool {"text": "Introducing", "style": "documentary", "animation": "fade", "text_size": 0.105, "y": 0.5,
  "position_seconds": 0.1, "duration_seconds": 3.3, "stagger_seconds": 0}
add_kinetic_title_tool {"text": "your cinematic crew", "style": "documentary", "animation": "fade", "text_size": 0.105, "y": 0.5,
  "position_seconds": 0.1, "duration_seconds": 3.3, "stagger_seconds": 0}
get_clip_properties_tool {"timeline_clip_id": "<lead id>"}      (read scale_x s0, location_x x0, location_y y0)
```
With the receipt's `box` [bx, by, bw, bh] for the lead word: centre T = (bx + bw/2, by + bh/2); inside the picture the centre is
c = ((Tx - x0)/s0, (Ty - y0)/s0). For a scale factor f and the word centre at (px, Ty) set scale = s0*f,
location_x = px - s0*f*cx, location_y = Ty - s0*f*cy. Keyframe at 0.1 s (f 2.3, px 0.5), 0.5 s (f 2.44, px 0.5), 0.9 s (f 1,
px 62 % of the way to the slot), 1.2 s (f 1, px = slot centre) with `set_keyframes_tool` on scale_x, scale_y, location_x, location_y
and `ease: ease_in_out_quart`. The slot centre comes from laying the two boxes out as one centred line with a 0.012-frame gap.
The rest: alpha 0 until 1.0 s then 1 within 2 frames, and `location_x` from its slot + 0.045 to its slot (1.0 to 1.5 s, `ease_out_quart`).
```json
add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 0.55, "gain_db": -16}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 0.6, "gain_db": -14}
```
End of the shot: do not scale the line yourself; put `apply_motion_transition_tool {"preset": "zoom_in"}` on the cut to the next shot.

## Timing & taste rules
- Start scale 2.3 (it just overflows the frame); a 6 % creep during a 12-frame (0.4 s) hold; under 1.8x it is only a big word.
- Shrink 12 frames (0.4 s), slide 24 frames (0.8 s) on the same heavy ease-in-out with no overshoot: the slide is the tail
  that gives the move its weight. Different curves split it into two beats.
- Words pushed in 0.5 em, 12 frames each, 4-frame stagger, 2-frame fade only: a long fade reads as "appears", not "pushed".
- Hold 22 frames (0.7 s) after it lands so a subtitle can be read. Lead word of about 10 characters; over 14 overflows the frame.
- One accent colour on one word only.

## Sound for it
A short whoosh as the shrink starts (-16 dB) and one soft thud as the first word is pushed in (-14 dB).

## Common mistakes
- Scaling the title without compensating the position: the word flies off the baseline or low into the frame.
- Pushing the rest in while the lead word is still sliding over its slot (overlapping glyphs): start them after the shrink ends.
- Ending the card with its own crash-zoom fade and no next shot to receive it.

## Verified
2026-10-29, CLI on generated media (no footage): scripts/shot-lead-word-zoom-assemble.sh → shots/shot-lead-word-zoom-assemble.mp4 (local only). Checked on the sheet: the lead word starts huge and centred, shrinks and slides left, the rest fades in beside it without overlapping; the line then holds. The second render fixed an overlap by starting the rest at 1.0 s; the line is small at 0.105, make it larger on a shorter sentence. Watch judge (absolute): **3.82/10**; main note: "The lead-in whoosh and slide-in concept correctly execute the requested technical prompt. However, the motion easing feels linear, stiff, and lacks secondary dynamics or motion blur."

Adapted from video-shotcraft card `shots/typography/lead-word-zoom-assemble.md` (Apache-2.0; see ../NOTICE).
