---
id: shot-type-rhythm-sync
kind: technique
summary: "When a heavy title must be the bass drum: its stroke weight pumps thin to black on each beat and decays."
categories: [kinetic-type-motion-design, music-lyric-video, sports-hype-edit, gaming-montage, movie-game-trailer]
tools: [detect_beats_tool, add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: frantic
mood: [hype, rhythmic, loud]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-beat-strobe, kinetic-lyric-sync, kcut-hit-fx]
avoid_with: [shot-blur-slide, kinetic-quote-card, kinetic-typewriter]
needs: [variable-weight-text]
---

# Font-weight pump on the beat

## What it is
The type does not move: its stroke weight does. On every drum hit a hairline word swells to black weight in one frame and decays
back in 9-13 frames, on a title that otherwise stays put. From the second bar, outline echoes above and below join in on the
beat; on the drop the word locks in a heavy weight with a gradient. The title becomes the bass. High-energy sections only; one per film.
The second half of this card (words filling with colour as the narrator says them) is the same move as kinetic-karaoke: use
`kinetic_captions_tool` with `style: "karaoke"` (see that technique).

## Build it in Zenvi
No variable-weight type (`needs: variable-weight-text`). Fallback: two stacked copies of the title, thin and black, with the black
copy's opacity pulsed by the beat envelope.
```json
detect_beats_tool {"file_id": "<music>"}                                  (beat times; or a grid: 128 bpm = one beat per 0.469 s)
add_title_tool {"template": "Standard_1", "text": "FRAME MOTION", "font": "Inter", "font_weight": "normal", "font_scale": 2.2, "text_color": "#e8e8ee", "background_color": "#101018", "position_seconds": 0, "duration_seconds": 5}
add_title_tool {"template": "Standard_1", "text": "FRAME MOTION", "font": "Inter", "font_weight": "bold", "font_scale": 2.2, "text_color": "#ffffff", "position_seconds": 0, "duration_seconds": 5}
set_keyframes_tool {"timeline_clip_id": "<bold copy>", "property": "alpha", "interpolation": "linear", "points": [
  {"seconds": 0.469, "value": 1}, {"seconds": 0.69, "value": 0}, {"seconds": 0.938, "value": 1}, {"seconds": 1.16, "value": 0}]}      (one 1-then-0 pair per beat; use mode merge to append)
set_keyframes_tool {"timeline_clip_id": "<bold copy>", "property": "scale_x", "interpolation": "linear", "points": [{"seconds": 0.469, "value": <s0 * 1.06>}, {"seconds": 0.69, "value": <s0>}]}      (accent beat of each bar only)
add_sfx_tool {"recipe": "hit_transient", "at_seconds": 0.469, "gain_db": -16}
```
For the echo lines add two extra copies above and below (alpha 0.4, pulsing 2 frames after the main one, pushed 26 px away on each beat) from the
second bar. A beat grid strip along the bottom (eight lit steps) makes it read with the sound off; build it from small `add_title_tool` marks.

## Timing & taste rules
- Envelope (1 - t/D)^0.8 per beat, decay D 9-13 frames; beat spacing must exceed the decay (128 bpm = 14 frames) or beats merge into a twitch.
- Accent the first beat of each bar with a 6 % width stretch and a colour shift; the drop beat goes to full black and settles to 78 % weight with a gradient in about 16 frames.
- Build by adding layers (echo lines from bar 2), not by increasing amplitude, or the last bar has nothing left.
- Hit frame and drum hit on the same frame; this does not work on a silent track.
- At most one weight-pump section per film.

## Sound for it
The music carries it; add a `hit_transient` (-16 dB) only on beats the track itself does not show. The drop gets `impact_slam`.

## Common mistakes
- Pulses off the drum by even 2 frames; beats closer than the decay window.
- Pumping the whole frame as well as the weight.
- Using this on a calm section.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/type-rhythm-sync.md` (Apache-2.0; see ../NOTICE).
