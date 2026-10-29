---
id: shot-trailer-bumper-hook
kind: technique
summary: "When a trailer needs a cold open: three 9-frame shots, a beat of pure black and silence, then the title fades in."
categories: [movie-game-trailer, gaming-montage, sports-hype-edit, product-launch-film, brand-story-corporate]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_title_tool, add_sfx_tool]
pace: fast
mood: [teaser, tense, cinematic]
aspect: ["16:9", "9:16"]
pairs_with: [cinematic-silence-before-hit, cinematic-trailer-sound, accelerating-cut-length-ramp]
avoid_with: [t041, shot-paparazzi-flash-crops]
needs: []
---

# Trailer bumper hook

## What it is
Before the film proper, the three most arresting shots, 9 frames each, hard-cut; then a 0.2 s hole of pure black and
silence; then the title. A hook that promises, then breathes.

## Build it in Zenvi
1. Three equal shots, 0.3 s each, hard cuts, all on track 1:
   `add_clip_to_timeline_tool {"file_id": "<F1>", "start_seconds": 2, "duration_seconds": 0.3, "position_seconds": 0, "track": "1"}`,
   then F2 at 0.3 s, F3 at 0.6 s. Compose each differently (wide / medium / tight); the third can be a 2.2x blow-up of a
   graphic.
2. Keep each alive with a push: `set_keyframes_tool {"timeline_clip_id": "<C>", "property": "scale_x", "interpolation": "linear",
   "points": [{"seconds": 0, "value": 1.0}, {"seconds": 0.3, "value": 1.04}]}` and the same for `scale_y`.
3. Leave 0.9 s to 1.1 s empty as pure black: nothing on any track, or
   `add_title_tool {"background_color": "#000000", "position_seconds": 0.9, "duration_seconds": 0.2}`.
4. Title from 1.1 s: `add_title_tool {"text": "<TITLE>", "template": "Standard_1", "position_seconds": 1.1, "duration_seconds": 3.6,
   "fade_in_seconds": 0.53, "font_weight": "bold", "background_color": "#000000"}`; rises 44 px over the fade (keyframe `location_y`
   from 0.04 to 0 with `ease_out_cubic`).
5. Sound: `add_sfx_tool {"recipe": "hit_transient", "at_seconds": 0, "gain_db": -10, "seed": 1}`, again at 0.3 s and 0.6 s; nothing in the black.

## Timing & taste rules
- Three shots of equal length, 9 f; the equal length is the beat. Distinct compositions.
- 1 to 1.04 linear push inside each: three static frames read as a slideshow.
- The black is 6 f (27 to 33): nothing at all in it, not a faint glow or a sound tail.
- Title fade 16 f with a 44 px out-cubic rise; then fully still for at least 40 f (the card uses 77 f).

## Sound for it
A tick per cut, everything muted in the black, the title on a soft `impact_thud` or a `sub_drop` at -14 dB.

## Common mistakes
- Putting a card, a flash or a riser tail in the black.
- Three shots of unequal length.
- Making it longer: past about 1 s it is a montage, not a hook.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/rhythm/trailer-grammar-moves.md` (Apache-2.0; see ../NOTICE).
