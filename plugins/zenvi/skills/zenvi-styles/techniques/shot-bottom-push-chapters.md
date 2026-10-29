---
id: shot-bottom-push-chapters
kind: technique
summary: "When a film is built in chapters: each new colour-ground chapter pushes the old one off the top, three times in a row."
categories: [saas-app-launch, product-launch-film, tech-review, brand-story-corporate, kinetic-type-motion-design]
tools: [add_kinetic_title_tool, apply_motion_transitions_tool, apply_motion_transition_tool, add_sfx_tool]
pace: medium
mood: [confident, graphic, rhythmic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-keyword-slam, kinetic-emphasis-scale, kcut-hit-fx]
avoid_with: [shot-solid-page-wipes, shot-hidden-cut-masks, cinematic-whip-cut]
needs: []
---

# Bottom push chapters

## What it is
Each chapter is a full-screen colour world; the next arrives from the bottom edge and pushes the previous one out at the
top, same speed, same direction, like a stack in a vending machine. Three pushes in a row with three saturated grounds
make the chapter change itself the film's metronome.

## Build it in Zenvi
1. One chapter per clip, a flat saturated card each with its line (headline stays inside its own card, so it travels with
   the colour):
   `add_kinetic_title_tool {"text": "Ask it anything", "style": "creator", "animation": "slide_up", "background": "#2d4cff",
   "position_seconds": 0, "duration_seconds": 2.0}`, then `"background": "#ff4d1f"` at 2.0 s, `"#cdf23a"` with
   `"ink": "#111111"` at 4.0 s.
2. Push every join upward, one direction for the whole film:
   `apply_motion_transitions_tool {"track": "1", "preset": "slide", "direction": "up", "duration": 0.7}`
   (or per cut `apply_motion_transition_tool {"preset": "slide", "clip1_id": "<A>", "clip2_id": "<B>", "direction": "up", "duration": 0.7}`).
   A kinetic title's own entrance starts 0.4 s after the push has landed (stagger it with `position_seconds` or the
   title's `stagger_seconds`), so only one thing moves at a time.
3. A push sound and a thud on every landing: `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 1.65, "gain_db": -14}`
   and `{"recipe": "impact_thud", "at_seconds": 2.0, "gain_db": -16}`.

## Timing & taste rules
- Push 26 f (about 0.85 s), strong ease-out (fast in, slow settle; about 95 % in the first 12 f); never linear, it reads as a
  roller blind.
- Chapter lives about 44 f from push start to the next push (hold at least 18 f still plus the landing).
- Grounds: one saturated colour per chapter, hues about 120 degrees apart; a grey chapter may only be chapter 0.
- Push 2-4 times. One is not a rhythm; past four the viewer counts colours.
- Direction fixed for the whole film (always from the bottom). Changing direction ends the metronome.
- Content inside a chapter animates only after the push lands.
- The 56 px seam shadow and the lit top edge of the card are not available as separate layers; flat joins are fine.

## Sound for it
`whoosh_short` at -14 dB under each push, `impact_thud` -16 dB on the landing, nothing in the holds.

## Common mistakes
- A push fighting a chapter's internal animation.
- Re-using the same ground twice in a row.
- Ending the film on a push; follow the last chapter with a still hold.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/transition/bottom-push-stack-wipe.md` (Apache-2.0; see ../NOTICE).
