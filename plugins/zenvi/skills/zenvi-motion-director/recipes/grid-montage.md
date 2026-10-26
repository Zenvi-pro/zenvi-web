# Grid montage

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
| 12-15 | the last tile grows to the full band (`merge`) and holds |

## Tools

1. Assets: 6-9 clips with strong motion and contrasting colour (city lights,
   waves, dancer, neon, skate, road). Clips with the action in the centre
   survive the narrow tiles.
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

   `layout: "strips_v"` for vertical strips (hype reels), `film_strip` for a
   sprocketed strip, `mosaic` for an irregular collage, `zoom_into: N` to end
   by pushing into one tile instead of `merge`.
4. Look: one LUT on every tile (`apply_look_tool` `all_clips: true`,
   `look_id: "city_neon_cinema"` or `"teal_punch"`, 0.6).
5. Sound: `auto_sound_design_tool` `intensity: "hype"` with the same
   `beats`; then make sure each tile reveal has a transient: `add_sfx_tool`
   `impact_punch` on the first tile of each layout step and on the merge
   (`swoosh_hit`), `seed` and `pitch` varied. Music at full level.

## Checks

`preview_frame` after each layout step fills (all tiles playing, gutters
even, nothing outside the band) and at the merge's end (full band, no
leftover tile edges). The tool refuses tiles under 13 % of the short side: on
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
