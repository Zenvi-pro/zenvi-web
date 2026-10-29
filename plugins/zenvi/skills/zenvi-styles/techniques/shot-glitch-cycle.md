---
id: shot-glitch-cycle
kind: technique
summary: "When a machine should narrate its progress: one slot cycles status phrases that decode from noise, a glitch per switch."
categories: [kinetic-type-motion-design, tech-review, saas-app-launch, vfx-tutorial-breakdown, science-curiosity]
tools: [add_motion_block_tool, apply_motion_transition_tool, add_sfx_tool]
pace: medium
mood: [technical, cold, urgent]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-scramble-decode, kinetic-counter, kcut-draw-on]
avoid_with: [shot-blur-slide, kinetic-quote-card, kinetic-write-on]
needs: []
---

# Glitch status cycle

## What it is
Four short status lines ("LOADING FOOTAGE", "LOCKING BEAT GRID", ...) play in one centred slot. Each melts in from noise and
settles clean for most of its time, with one small flicker mid-line, then breaks up into the next. The last line decodes to
clean and stays. Reads as a system talking to itself: build, deploy and render sequences, tech openers, "how it works" beats.

## Build it in Zenvi
One `text_scramble` block per phrase, back to back on one track (38 frames = 1.2667 s each; use frame-exact positions so
they do not overlap onto a second track), then a glitch on each cut except the last:
```json
add_motion_block_tool {"block": "text_scramble", "position_seconds": 0, "duration_seconds": 1.2667, "placement": "full_frame", "track": 1,
  "params": {"text": "LOADING FOOTAGE", "glyphs": "symbols", "label": "STEP 1 / 4", "palette": "night", "accent": "#ff3d8b",
             "display_font": "mono", "size": 78, "align": "center"}}
```
Repeat at 1.2667, 2.5333 and 3.8 with the other phrases (same params, `label` STEP 2 / 4 ...).
```json
apply_motion_transition_tool {"preset": "glitch", "track": 1, "time": 1.2667, "duration": 0.17, "intensity": 1.2}
add_sfx_tool {"recipe": "glitch_burst", "at_seconds": 1.2667, "gain_db": -16, "seed": 5}
```
Do the same at 2.5333 and 3.8 (new `seed` each); finish with `add_sfx_tool {"recipe": "toggle", "at_seconds": 4.9, "gain_db": -18}`
on the last line. The block decodes the head of each line; the glitch transition is the "melt out". A progress bar under the
slot is not in the block: add a thin `add_title_tool` line or accept its absence.

## Timing & taste rules
- 38 frames (1.27 s) per phrase is the floor for reading one status; with 5 or more phrases widen the noisy head and tail.
- Noise is heavy at the head and tail of a phrase and almost zero in the middle, with one small flicker (about 10 %) at
  the half; a phrase that flickers all the way through reads as a broken video.
- Re-roll the noise every 2 frames; every frame is grey mush, 4 frames or more reads as another word.
- Keep the phrases within 12-17 characters of each other: the slot is as wide as the longest and a short line sits lost.
- The last phrase ends clean: no glitch on the last cut, hold at least 20 frames.
- Dark background, one hot accent: RGB split is invisible on a light ground.

## Sound for it
A different `glitch_burst` seed on each switch (-16 dB), never the same sample twice in a row; a soft `toggle` on the last line.
The switch points are the rhythm: if there is music, land them on its beats.

## Common mistakes
- Overlapping blocks (a fractional-frame duration pushes the third one to track 2): place on exact frame boundaries.
- A glitch on the final cut, or noise left at the end of the last phrase (the shot reads as not rendered).
- Phrases of very different length.

## Verified
2026-10-29, CLI on generated media (no footage): scripts/shot-glitch-cycle.sh → shots/shot-glitch-cycle.mp4 (local only). Checked on the sheet: four phrases each decode from symbol noise to clean, a pink block rides the decode front, glitch frames between phrases, the last line stays clean with a tick. Watch judge (absolute): **7.73/10**; main note: "The hacker/terminal decoding aesthetic is executed with crisp motion typography and responsive UI sounds. ... However, the final resolve cuts out abruptly without a sustained hold or satisfying concluding sound event."

Adapted from video-shotcraft card `shots/typography/glitch-cycle.md` (Apache-2.0; see ../NOTICE).
