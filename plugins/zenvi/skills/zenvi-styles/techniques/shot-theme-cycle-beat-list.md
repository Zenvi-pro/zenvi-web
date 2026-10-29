---
id: shot-theme-cycle-beat-list
kind: technique
summary: "When one product has many moods: an adjective list steps up a row per beat while the ground changes colour in step."
categories: [saas-app-launch, kinetic-type-motion-design, product-launch-film, tech-review]
tools: [add_motion_block_tool, add_title_tool, set_keyframes_tool, detect_beats_tool, add_sfx_tool]
pace: frantic
mood: [playful, rhythmic, bold]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-word-rotator, kinetic-beat-strobe, kcut-strobe-cards]
avoid_with: [cinematic-silence-before-hit, kinetic-quote-card, shot-gradient-type-shift]
needs: [motion-block-word-cues]
---

# Theme cycle on the beat

## What it is
A dark column of adjectives steps up one row per beat; the word in the fixed highlight takes a new colour and the whole
ground flips to a matched colour on the same beat. Three channels (row, pill, ground), one clock: a metronome made of
the cheapest change there is. For "modern, playful, expressive, bold, yours" style feature runs.

## Build it in Zenvi
1. Beat grid: `detect_beats_tool` on the music, or pick 100 bpm (18 f = 0.6 s per beat).
2. Grounds, one hard-cut colour card per beat, matched dark pairs of equal lightness (never dark to light):
   `add_title_tool {"background_color": "#2a1744", "position_seconds": 1.0, "duration_seconds": 0.6}` then the next
   colour at 1.6 s, 2.2 s, 2.8 s, 3.4 s (a title with no text is a plain colour card).
3. The list over the cards, transparent: `add_motion_block_tool {"block": "word_rotator", "params": {"prefix": "Make it",
   "words": ["modern", "playful", "expressive", "bold", "yours"], "style": "slot", "palette": "dark"},
   "position_seconds": 1.0, "duration_seconds": 3.4, "placement": "over_video"}`
4. Make it land on the beats: the block spreads its words evenly over its length, so set `duration_seconds` to
   (words - 1) x beat + about 0.6 s and start it on the first colour card. There is no per-word beat input
   (`needs: motion-block-word-cues`); check on the render that each step meets its card change within 2 frames and shift
   `position_seconds` if not. Add a 1 s still lead-in before the first beat so the list reads as a list.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.0, "gain_db": -16, "seed": 1}` on every beat (new seed each).

## Timing & taste rules
- Beat 18 f (0.6 s): under 12 f the words cannot be read; over 26 f the metronome turns into a slideshow.
- Only the first 6 f of a beat moves (steep ease-out), the other 12 f are still: jump, never glide.
- 3-4 beats; 5 and more and the viewer stops watching, 1-2 never feel like a metronome.
- Keep 2 more words in the list than there are beats, so the last beat is not the bottom row. Hold the last colour 1 s.
- Neighbouring grounds: same lightness, different hue. A light/dark flip reads as a screen flash.
- The pill squash (1.14 / 0.96 / 1) and per-theme typeface change are not available; the colour change carries it.

## Sound for it
A tick (`ui_tap`) or `hit_transient` on every beat at -16 dB, over a bed whose kick is on the same grid. Silent, the
three channels just look like the screen is glitching.

## Common mistakes
- Row, colour and ground drifting a frame apart: they must share one beat.
- A scrolling list that never stops between beats: it becomes a plain ticker.
- Grounds hand-picked at random instead of pairs.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/rhythm/beat-step-list-theme-cycle.md` (Apache-2.0; see ../NOTICE).
