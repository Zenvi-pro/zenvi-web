---
id: whip-transition-motion-blur-smear
kind: technique
summary: "When the piece jumps to a new place or subject: a 6-10 frame whip pan smear with a whoosh, used 1-3 times."
categories: [fitness-lifestyle, real-estate-tour]
tools: [apply_motion_transition_tool, add_sfx_tool, pan_tool, list_motion_transitions_tool]
pace: fast
mood: [energetic, playful, kinetic]
aspect: ["9:16", "16:9", "1:1", "4:5"]
pairs_with: [cut-on-action, accelerating-cut-length-ramp, voice-over-bed-mix-balance]
avoid_with: [negative-space-chapter-breath, soft-bloom-lifted-shadow-grade]
needs: []
---

# Whip transition (motion blur smear)

## What it is
The camera seems to whip off one subject and land on the next: a directional
smear of 6-10 frames that hides the cut. It is a hand-off between places,
used sparingly (three in 70 s in the best fitness piece), never between two
shots of the same scene.

## Build it in Zenvi
```json
apply_motion_transition_tool {"preset": "whip", "clip1_id": "<out>", "clip2_id": "<in>",
  "direction": "left"}
add_sfx_tool {"recipe": "whip", "at_seconds": <cut - 0.1>, "gain_db": -16}
```
- `direction` follows the motion in the frame: the subject or camera moving
  right in the outgoing shot means `"right"`; a tilt reveal is `"up"`.
- Default length 8 frames (0.27 s); `duration` 0.2-0.33. `intensity` lower for
  calm pieces.
- `pan_tool` on the whoosh, left-to-right with the whip, for stereo pieces.
- Real camera whips in the footage beat any synthetic one: cut inside them
  (`cut-on-action`) and add only the whoosh.

## Timing & taste rules
- 1-3 per 30 s, and only at a change of world (gym to street, room to room).
- Cut on motion: both shots should already move the way of the whip; a whip
  out of a locked-off shot into a static one reads synthetic (the judge's main
  note on the test).
- After a whip, the incoming shot settles for at least 1 s.

## Sound for it
A whip or `whoosh_short` 3-6 dB under the hero hit, peaking on the cut, under
the music; in a voice piece, -18 dB under the voice or none.

## Common mistakes
- A whip on every cut.
- Direction against the subject's motion.
- Silence before the whoosh (the test started silent, so the whoosh popped out).

## Verified
2026-10-28: 5 s test, yoga (living room) to boxing (gym), `whip` left, a
`whip` SFX at the cut. Contact sheet and frame at the cut: horizontal smear,
lands on the boxing shot. Watch judge transitions 4, overall 3.27: the whip feels
synthetic because neither shot moves; the rule above (cut on motion) is the fix.
