---
id: cin-cl-context-palette-shift
kind: technique
summary: "When the context changes but the foreground stays: the backdrop colour shifts behind a parked hero."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool]
pace: medium
mood: [contextual, smooth, quiet]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-drain-stage-keep-hero, cin-cl-duotone-until-featured, prompt-bar-typing-hero]
avoid_with: [cin-cl-mono-one-accent, cin-cl-one-hue-light-ramp]
needs: []
drawn: cinetic
---

# Palette shift as context cue

cinetic `cl-context-palette-shift` · Colour and light · workhorse · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The world's colour changes behind a steady foreground, for a whole act or for one beat, to say 'new context' or 'this is the moment' without words.

Use when: Act changes without title cards, entering another app's world, or flagging the key moment (the user's prompt, the reveal).

## Build it in Zenvi

1. Backdrop A on track 1: `add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 9, "params": {"style": "orbs", "colors": ["#14161c", "#1f2430"], "speed": 0.2}, "track": "1"}`.
2. Backdrop B (the new context, brighter and more saturated) on track 2, same length: `add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 9, "params": {"style": "orbs", "colors": ["#2b4fa8", "#7fa6ff"], "speed": 0.2}, "track": "2"}`.
3. Shift on the beat: `set_keyframes_tool {"timeline_clip_id": "<backdrop_B>", "property": "alpha", "points": [{"seconds": 0, "value": 0}, {"seconds": 3.0, "value": 0}, {"seconds": 3.7, "value": 1, "ease": "ease_in_out_sine"}, {"seconds": 8.0, "value": 1}, {"seconds": 8.2, "value": 0, "ease": "ease_in_cubic"}]}` (42 f = 0.7 s up; hold up to about 300 f = 5 s, then step back on the next wide).
4. The hero stays untouched on a track above, e.g. `add_motion_block_tool {"block": "prompt_bar", "position_seconds": 1.0, "duration_seconds": 7, "params": {"prompt": "A calm product film"}, "track": "3"}`; give it no keyframes during the shift.
5. For a whole-act switch, put the new palette on the cut instead (0 f), or hide it in a zoom-through transition.

## Timing & taste rules

- cinetic's timing (60 fps): Act switches happen in 0 f (0.00 s) on a cut. A neutral process act can be as short as 74 f (1.23 s). A backdrop shift takes 42 f (0.70 s) on ease_in_out_sine. A hero-beat backdrop holds for up to about 300 f (5.00 s) before stepping back.
- Act switches happen in 0 f on a cut; a neutral process act can be as short as 74 f (1.2 s).
- A backdrop shift lifts luma about 100 levels over 42 f (0.7 s, ease_in_out_sine).
- A hero-beat backdrop holds for up to about 300 f (5 s) before stepping back.
- The hero never moves during the shift so the eye stays parked on it.
- Two or three palettes at most per film, tied to acts.

## Sound for it

None; a colour change is quiet. If the shift hides a zoom-through transition, that transition's own whoosh covers it.

## Common mistakes

- The foreground moving during the shift; the cue gets lost.
- A film shorter than two acts, where there is no context to change.
- More than three palettes, which stops reading as context.
- Avoid when: The foreground is moving at the same time (the cue gets lost), or the film is shorter than two acts.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-context-palette-shift`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
