# Match-cut montage

Shots that share a shape or pose (circles: cup, lamp, sun, moon, eye, vinyl,
lens, clock; poses: arms out, head down) cut so the subject never jumps.
Reference feel: 15 s, ~0.3 s average shot, a sound on 75 % of cuts.

## Structure (15 s, 30 fps)

| t (s) | what | length |
| --- | --- | --- |
| 0-1.2 | opening pose, held, slow push | 30-36 f |
| 1.2-2.2 | the same pose elsewhere (the "full circle" promise) | 24-30 f |
| 2.2-12.5 | the chain: one shape per shot | 3-8 f each, faster towards the end |
| 12.5-15 | the payoff shape, held, music tail | 45-75 f |

Order the chain by size and brightness so neighbours already resemble each
other (dark round → dark round, warm → warm); end on the most iconic one
(eye, sun, clock).

## Tools

1. Assets: 12-16 clips, one search per shape ("coffee cup top view", "full
   moon night sky", "human eye close up macro"...). Prefer centred, single,
   round subjects filling 20-50 % of the frame height; skip clips with two
   circles.
   Look at each candidate (`inspect_media_tool` `fileId`, `overview: true`)
   and drop it unless one clear shape fills the middle: an ear, a label or
   two circles break the chain. Each shape once or twice, never the same
   file cycled five times.
2. Subjects: give **every** file a box in `subjects`. Circles:
   `detect_subject_tool` (`file_id`, `time`) and keep the candidate that is
   the subject. Poses and heads: read the person's box off
   `inspect_media_tool` (`fileId`, `start`, `end`, `maxFrames: 3`) frames. A
   file without a box gets circle detection, which on a pose shot finds a
   random round thing and zooms 10x into it.
3. Cut it in one call:

```json
match_cut_montage_tool {
  "file_ids": ["<pose A>", "<pose B>", "<cup>", "<lamp>", "<sun>", "<moon>", "<eye>", "<vinyl>", "<clock>"],
  "subjects": [{"file_id": "<pose A>", "box": {"x": 0.38, "y": 0.22, "w": 0.24, "h": 0.6}, "time": 2.0}],
  "music_file_id": "<track>",
  "duration_seconds": 15,
  "min_frames": 3, "max_frames": 8,
  "flash": true, "zoom_drift": 0.04,
  "target": {"x": 0.5, "y": 0.5, "size": 0.4}
}
```

   `target.size` 0.3-0.45 (a circle a third of the frame tall) keeps the
   chain readable; with the default the subjects grow until the smallest
   source fills the frame. Pose files are aligned by their box too, so put
   the pose pair first and the circles after.

   Its receipt has the beats and the shots; it already aligns every shot
   (`cover: zoom_all`) and puts white flashes on downbeats.
4. Grade: `apply_look_tool` `look_id: "teal_&_orange_cinema"` (or
   `"warm_cinema"`), `all_clips: true`, `lut_intensity: 0.6`, `grain_preset:
   "35mm_fine"` (give `grain_preset` alone: `stack_grain: true` wins and
   picks 35mm_classic).
5. Sound: `auto_sound_design_tool` `intensity: "hype"` with the receipt's
   `beats`. It puts a hit or whoosh on nearly every cut; check with
   `get_timeline_state_tool` that the opening pose pair has a
   `whoosh_medium` and the payoff an `impact_boom`.
6. Optional: a small title on the payoff (`add_title_tool` `font: "Instrument
   Serif"`, `font_style: "italic"`), 2-3 words, never over the subject.

## Checks

Read the receipt: a shot scaled above about 2.5x is soft and was aligned on
the wrong thing; fix its box (or drop the file) and rerun with `replace: true`.
Too dark to read (a black lamp shade, a night shot): drop it. The payoff shot
holds 1.5-2.5 s; if the last shot is longer, lower `duration_seconds` or add
files.

`inspect_timeline_tool overview: true`, then `preview_frame` on 5 consecutive
chain cuts (`grid: true`): the circle's centre within ±0.03 and its size
within ±10 % from shot to shot. If one drifts, fix its box and rerun with
`replace: true`, or `align_match_cut_tool` on the clips.

## Pitfalls

- Holding chain shots 1-2 s: it becomes a slideshow of round things.
- Motion transitions between match cuts: the hard cut is the effect. At most
  `flash_white` on downbeats (the tool does it).
- Music used as sound effects; use the SFX tools, keep the music bed whole.
- Different grades per shot: the match only works when the frames rhyme.
