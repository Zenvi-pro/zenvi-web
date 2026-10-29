---
id: object-pop-out-with-clean-plate-swap
kind: technique
summary: "For a VFX hook: black bars squeeze the frame and the person (or object) breaks out over them with a steep ease-out."
categories: [vfx-tutorial-breakdown]
tools: [pop_out_tool, generate_subject_matte_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [playful, surprising, techy]
aspect: ["9:16", "16:9"]
pairs_with: [comic-burst-insert, tutorial-packaging-kit, split-screen-compare-layout]
avoid_with: [foreground-occluder-cut-in-footage]
needs: [tracked-object-matte]
---

# Object pop-out with clean-plate swap

## What it is
Letterbox bars slide in and squeeze the picture into a band; the subject (a
jumper, a thrown ball) leaves the band and passes over the bars, as if it broke
the frame. The VFX tutorial version films a real throw, removes the object with
a clean plate and composites a roto'd replacement above the bars.

## Build it in Zenvi
For people (native):
```json
pop_out_tool {"clip_id": "<clip>", "band_aspect": 1.4, "bar_color": "#000000"}
add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": <bars slide in>, "gain_db": -9}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": <each landing>, "gain_db": -7}
```
- `pop_out_tool` builds the matte (`generate_subject_matte_tool`), the bars and
  the subject copy in one undo step; CLI / local only (the matte is a
  rendered layer).
- `band_aspect` 1.4 on 9:16 leaves room above and below for the break; 2.39 is
  the cinema band for 16:9.
- Objects (ball, product): no matte for non-people (`tracked-object-matte`).
  Fallback: an `add_shape_mask_tool` ellipse on a copy of the clip, keyframed
  by hand along the ball's path (`set_keyframes_tool` on the mask clip's
  location), only for slow, short moves.

## Timing & taste rules
- Bars in over 6-10 frames with ease-out, before the action peaks; the break
  is the apex of the jump or throw.
- Hold the band 2-3 s, then open the bars back on a beat (judge: "animate the
  bars back to full screen to finish").
- The subject must clearly exit the band (at least 15 % of its height over
  the bar); otherwise it reads as a mask error.

## Sound for it
A whoosh as the bars squeeze, a thud on each landing or catch, a hit when the
subject crosses the bar; foley at -7 to -9 over the bed (the test with quiet
cues was heard as "no sound design").

## Common mistakes
- Fast limbs: the matte edge chatters (judge saw jagged, jittery edges on the
  feet); prefer clips with clean silhouettes against sky or a plain wall.
- Ending in the band: release it.

## Verified
2026-10-29: 4.5 s 9:16 test, a person jumping, `pop_out_tool` band 1.4.
Contact sheet: bars in, the jumper's legs and arms over the bars on the
apex. Judge 3.09 both passes (pass 2 with louder landings): matte fringing on
fast feet and no release of the bars. Fidelity approximates.
