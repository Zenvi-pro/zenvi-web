---
id: beat-staggered-tile-and-slice-build
kind: technique
summary: "For a beat-driven drop: a shot builds from 6-9 tiles or strips, one per beat, then merges to full frame on a hit."
categories: [flash-cut-match-cut-edit, sports-hype-edit, travel-cinematic-montage]
tools: [add_motion_template_tool, detect_beats_tool, add_sfx_tool, apply_motion_transition_tool, unify_grade_tool]
pace: fast
mood: [energetic, graphic, rhythmic]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [monochrome-to-colour-hit-flash, tiled-video-wall, withheld-music-cold-drop, bar-phrase-and-lyric-locked-cutting]
avoid_with: [grid-cell-reflow-and-collapse, slow-motion-hero-passage]
needs: [datamosh-carry]
---

# Beat-staggered tile and slice build

## What it is
The frame is built from 6-9 tiles or 8-10 strips that arrive on successive
beats (5-10 frames each, ease-out), then collapse to one full-frame shot on a
hit. It turns the drop of a 9:16 moto, sport or travel edit into a graphic
event, and works once per piece, at the drop or a section change.

## Build it in Zenvi
```json
detect_beats_tool {"file_id": "<music>"}
add_motion_template_tool {"template": "grid", "file_ids": ["<6 clips>"], "position_seconds": <drop - 6 beats>,
  "duration_seconds": <6-9 beats>, "layout": "strips_h", "tiles": 6, "reveal": "slide", "merge": true,
  "beats": [<beats moved to the timeline>], "gutter": 4}
add_sfx_tool {"recipe": "ui_tap", "at_seconds": <each tile's beat>, "gain_db": -16, "pitch": <0, 2, 4...>, "pan": <tile x>}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": <merge beat>, "gain_db": -8}
```
- Layouts: `strips_h` (venetian slices), `strips_v`, `grid` with `tiles` 6 or
  9, `mosaic`. `merge: true` grows the last tile to full frame; `zoom_into`
  pushes into one tile instead.
- Beats must be timeline seconds (detect_beats_tool times minus the music
  clip's start offset, plus its position).
- The light-bar diagonal wipe and the datamosh carry of the reels are not
  native (`datamosh-carry`); a `flash_white` motion transition into the next
  shot is the fallback for the collapse.

## Timing & taste rules
- One tile per beat (0.4 s at 150 bpm); the build lasts 6-9 beats, never more
  than 4 s.
- Strips of one shoot read as one picture being assembled; six unrelated
  sports read as a collage (the judge's note on the test: "random framing cuts
  off the action"). Pick tiles whose subject sits in the strip's band.
- One grade over every tile (`unify_grade_tool`) before building.
- Land the merge on a downbeat and cut the music's next phrase on it.

## Sound for it
A tick per tile, pitched up a step each (multiplicity palette), panned with the
tile's x × 0.5; a centred punch on the merge, 8-12 dB over the ticks.

## Common mistakes
- Using it as a transition between every section (it is a moment, not glue).
- Tiles arriving off the beat because the beat list was not moved to the
  timeline.
- Ending the merged shot with nothing: follow it with a hard cut on the next
  bar or a hero hold.

## Verified
2026-10-29: 6 s 9:16 test, six stock sports clips as `strips_h` on the trap
bed's post-drop beats (149.8 bpm), merge to the bike shot, punch on the merge.
Contact sheet: strips slide in one per beat, the last grows to full frame.
Watch judge (abs) 5.64: wants a harder flash on the merge and subjects framed
inside their strips.
