---
id: shot-panel-grid-beats
kind: technique
summary: "When a thing has many angles or many things happen at once: a split screen hard-cuts in panel by panel on the beat."
categories: [saas-app-launch, product-launch-film, movie-game-trailer, flash-cut-match-cut-edit, kinetic-type-motion-design]
tools: [add_motion_template_tool, add_sfx_tool, detect_beats_tool]
pace: fast
mood: [dense, comic, energetic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-hit-fx, cinematic-montage-rhythm, shot-jump-cut-punch-in]
avoid_with: [shot-mosaic-reflow, kcut-strobe-cards]
needs: [multi-clip-grid-layout, skewed-mask-cascade, tile-event-stagger]
---

# Panel grid on the beat

## What it is
Two cards, one idea: the picture is split into 2-4 panels with thin gutters that cut in on the beat (the comic version:
three angles of one subject, slashed in diagonally, then the last panel eats the screen into a poster; the busy
version: a 2x2 where four little scenes run at once, their key moves offset by a few frames). For "many features at
once" mid-trailer peaks and single products shown from several cameras.

## Build it in Zenvi
1. Beats: `detect_beats_tool` on the track (or `bpm`).
2. Three angles of one subject:
   `add_motion_template_tool {"template": "grid", "layout": "strips_v", "tiles": 3, "file_ids": ["<wide>", "<detail>", "<macro>"],
   "bpm": 120, "reveal": "cut", "gutter": 12, "radius": 0, "palette": "editorial", "duration_seconds": 4}`
   (panels arrive one per beat; `reveal: "pop"` gives the small 1.07 to 1 punch).
3. Four parallel scenes: `{"template": "grid", "layout": "grid", "tiles": 4, "file_ids": [..4 clips..], "reveal": "cut",
   "gutter": 8, "radius": 20, "bpm": 120, "duration_seconds": 3}`. To end poster-style add `"merge": true`
   (last tile grows to fill the frame) or `"zoom_into": 3`.
4. Stagger the scenes by cutting the four source clips so each one's key event (typing, push, click) lands 3-6 frames
   after its neighbour's; the template cannot offset them (`needs: tile-event-stagger`). Diagonal comic gutters need a
   skewed matte (`needs: skewed-mask-cascade`); the straight gutters are the fallback.
5. `add_sfx_tool {"recipe": "hit_transient", "at_seconds": <beat>, "gain_db": -14, "seed": n}` for each panel.

## Timing & taste rules
- Comic form: slashes 4 f apart, each panel pops in over 5 f with a white flash, then hold ~29 f; the main subject must
  keep moving (a dial turning, a slow push) or it reads as a screenshot collage. Keep to one subject
  (three different things become a bento layout, not a comic).
- Parallel form: neighbouring heavy events 3-6 f apart (under 2 f = same beat, over 8 f = the bombardment is lost);
  no two quadrants make a heavy move on the same frame; about 2 s of bombardment, then a 1 s hold of all four final states.
- Alternate panel lightness (light / dark / accent / light) by at least 15 %.
- Once per film; the grid language is too recognisable for a second use.

## Sound for it
A `hit_transient` per panel (-14 dB, new seeds), the heaviest event (a push) on `impact_punch`; the poster take-over on `impact_slam`.

## Common mistakes
- All four panels moving on the same frame.
- Unrelated panels in a "comic" split.
- Low-resolution source: the tightest panel may be 2.45x enlarged.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/rhythm/panel-grid-moves.md` and `shots/rhythm/quad-split-parallel-scenes.md` (Apache-2.0; see ../NOTICE).
