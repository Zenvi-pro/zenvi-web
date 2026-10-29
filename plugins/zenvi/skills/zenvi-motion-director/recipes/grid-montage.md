---
id: grid-montage
kind: style
summary: Many clips on one beat - a split-screen band filling a tile per beat, 3 to 4 to 6 panels, then one shot
categories: [travel-cinematic-montage, fashion-beauty-ad, music-lyric-video, food-recipe]
tools: [add_motion_template_tool, detect_beats_tool, auto_sound_design_tool]
pace: fast
mood: [rhythmic, graphic]
aspect: ["9:16"]
pairs_with: []
avoid_with: []
---
# Grid montage

**One call first:** `produce_video_tool` `{"request": "<the brief as written>", "output": "output.mp4"}`
cuts this recipe with its builder, finishes, renders and reviews in one call. The rest of
this file is for layering on that cut and fixing what its review lists, or for
building by hand when no builder fits.

A letterboxed band in a vertical frame splits into panels that fill one per
beat, each a different clip; the layout steps 3 → 4 → 6 and merges into one
full shot. Reference feel: one tile per beat at ~150 bpm, a hit per tile,
black bars, almost no camera motion (the layout is the motion).

## Structure (15 s, 9:16, 150 bpm ≈ 0.4 s per beat)

| t (s) | what |
| --- | --- |
| 0-0.4 | black frame with the empty band, a riser starts |
| 0.4-4 | 3 panels fill, one per beat; hold a beat full |
| 4-7.5 | re-cut into 4 panels, fill again |
| 7.5-12 | 6 panels, fill again (fastest part) |
| 12-15 | the last tile grows to fill the frame (`merge`) and holds |

## Tools

1. Assets: **source count: one clip per tile of the largest step** (6 for
   `steps: [3, 4, 6]`, 9 for a 3 x 3), with strong motion and contrasting
   colour, in one `gather_stock_footage_tool` call (`queries`: city lights,
   waves, dancer, neon, skate, road; `count` = the tiles). Clips with the
   action in the centre survive the narrow tiles. Fewer files than tiles
   shows a clip twice at once: the tool warns (`strict_variety: true`
   refuses) and says how many more.
2. Music first (the tiles read the beats from the timeline's music):
   `import_stock_media_tool` the track, `add_clip_to_timeline_tool` on its own
   track at 0, `detect_beats_tool` on that clip.
3. The montage in one call:

```json
add_motion_template_tool {
  "template": "grid", "layout": "grid", "steps": [3, 4, 6], "band": 2.39,
  "file_ids": ["<c1>", "<c2>", "<c3>", "<c4>", "<c5>", "<c6>"],
  "reveal": "pop", "gutter": 6, "merge": true,
  "position_seconds": 0.4, "duration_seconds": 14.6,
  "beats": [0.4, 0.8, 1.2, 1.6, 2.0, 2.4]
}
```

   Size it to the piece: the grid takes about one beat per tile plus a
   beat per step and two for the merge, from the `beats` you pass. At 150
   bpm, `steps: [3, 4, 6]` is about 6.5 s; for a 15 s piece pass every second
   beat (tiles on half-time, ~12 s), or follow the merge with full-band cuts
   on the beat. The merged shot holds 2 s at most: a long hold after the
   last tile is the slideshow moment of this genre. (`merge` grows the tile
   to the whole frame, out of the band; to stay letterboxed end on
   `zoom_into` instead.)

   Each re-cut (3 → 4 → 6) whips every tile left together in the same undo
   step (`transitions: "auto"`; `"flash"` for an inverted frame and a glitch,
   `"none"` for plain cuts); `data.transitions` lists them.

   `layout: "strips_v"` for vertical strips (hype reels), `film_strip` for a
   sprocketed strip, `mosaic` for an irregular collage, `zoom_into: N` to end
   by pushing into one tile instead of `merge`.
4. Look: one LUT on matched tiles: `unify_grade_tool` `{"look":
   "city_neon_cinema", "look_intensity": 0.6}` (or `"teal_punch"`).
5. Sound: `auto_sound_design_tool` `intensity: "hype"` with the same
   `beats`; then make sure each tile reveal has a transient: `add_sfx_tool`
   `impact_punch` on the first tile of each layout step and on the merge
   (`swoosh_hit`), `seed` and `pitch` varied. Music at full level.

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 5 above (`intensity: "hype"`, `density: "every_cut"`).
2. `master_audio_tool` `{"preset": "social", "genre": "general", "iterate": true}` (fixes what analyze_mix_tool finds, then masters), after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

## Checks

`preview_frame` after each layout step fills (all tiles playing, gutters
even, nothing outside the band) and at the merge's end (the tile fills the frame, no
leftover tile edges or bars). The tool refuses tiles under 13 % of the short side: on
9:16 with a 2.39 band, 6 is the most that reads.

## Pitfalls

- Tiles filling off the beat: pass `beats`, or put the music on the timeline
  before the grid call.
- The grid finished in 6 s of a 15 s piece and one shot holds for the rest:
  pass half-time beats or plan the cuts after it.
- The same clip in neighbouring tiles: give at least as many files as the
  largest step.
- Camera moves on the whole grid: the layout is the motion; keep it still
  until the merge.
