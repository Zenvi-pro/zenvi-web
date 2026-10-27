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

1. Assets: **source count 12-16 clips** in one call, a query per shape:
   `gather_stock_footage_tool` `{"queries": ["coffee cup top view", "full
   moon night sky", "human eye close up macro", ...], "count": 16,
   "min_seconds": 3}`. Prefer centred, single,
   round subjects filling 20-50 % of the frame height; skip clips with two
   circles.
   Look at each candidate (`inspect_media_tool` `fileId`, `overview: true`)
   and drop it unless one clear shape fills the middle: an ear, a label or
   two circles break the chain. **Each strong shot at most twice**: count the
   uses per file in the receipt's shots; a file back three or more times
   means add files (one more search per shape) or lower `duration_seconds`,
   then rerun with `replace: true`. The tool runs the chain back and forth
   rather than looping it; still vary `file_ids` so the strongest match
   (eye, sun) sits at the payoff, not in every pass.
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
  "subjects": [
    {"file_id": "<pose A>", "box": {"x": 0.38, "y": 0.22, "w": 0.24, "h": 0.6}, "time": 2.0},
    {"file_id": "<pose B>", "box": {"x": 0.36, "y": 0.2, "w": 0.26, "h": 0.62}, "time": 1.5},
    {"file_id": "<cup>", "box": {"x": 0.3, "y": 0.36, "w": 0.4, "h": 0.3}},
    {"file_id": "<lamp>", "box": {"x": 0.32, "y": 0.3, "w": 0.36, "h": 0.36}},
    {"file_id": "<sun>", "box": {"x": 0.4, "y": 0.42, "w": 0.2, "h": 0.12}},
    {"file_id": "<moon>", "box": {"x": 0.42, "y": 0.43, "w": 0.16, "h": 0.09}},
    {"file_id": "<eye>", "box": {"x": 0.44, "y": 0.46, "w": 0.12, "h": 0.07}},
    {"file_id": "<vinyl>", "box": {"x": 0.15, "y": 0.33, "w": 0.7, "h": 0.39}},
    {"file_id": "<clock>", "box": {"x": 0.25, "y": 0.36, "w": 0.5, "h": 0.28}}
  ],
  "music_file_id": "<track>",
  "duration_seconds": 15,
  "min_frames": 3, "max_frames": 8,
  "flash": true, "zoom_drift": 0.04,
  "target": {"x": 0.5, "y": 0.5, "size": 0.4},
  "strict_variety": true
}
```

   `target.size` 0.3-0.45 (a circle a third of the frame tall) keeps the
   chain readable; with the default the subjects grow until the smallest
   source fills the frame. Pose files are aligned by their box too, so put
   the pose pair first and the circles after.

   Its receipt has the beats and the shots; it already aligns every shot
   (`cover: zoom_all`), puts white flashes on downbeats and a motion
   transition once a bar between them (`transitions: "punch"`, the default:
   a crash zoom about the subject, a glitch, and a zoom-through into the
   subject on the last cut; `data.transitions` lists them). The music's
   tempo is known? Pass `bpm` (and `offset_seconds`, where the first beat
   is) instead of letting it track. `strict_variety` refuses when a file
   would come back within 3 s and says how many more to gather: gather
   them and rerun.
4. Grade, on matched plates: `unify_grade_tool` `{"look":
   "teal_&_orange_cinema", "look_intensity": 0.6}` (or `"warm_cinema"`), so
   the moon and the cup sit in one world; then grain only: `apply_look_tool`
   `all_clips: true`, `look_id: "grain:35mm_fine"`.
5. Sound: `auto_sound_design_tool` `intensity: "hype"`, `density:
   "every_cut"`, with the receipt's `beats`. It puts a hit or whoosh on nearly every cut; check with
   `get_timeline_state_tool` that the opening pose pair has a
   `whoosh_medium` and the payoff an `impact_boom`.
6. Optional: a small title on the payoff, 2-3 words, never over the subject:
   `add_kinetic_title_tool` `{"text": "full circle", "style": "editorial",
   "animation": "rise"}` (it keeps to the shot's calm side).

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 5 above (`density: "every_cut"`).
2. `master_audio_tool` `{"preset": "social", "genre": "match_cut", "iterate": true}` (fixes what analyze_mix_tool finds, then masters), after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

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
- More motion transitions between match cuts: the hard cut is the effect.
  The tool's punches (once a bar, about the aligned subject) are the most the
  chain takes; do not run apply_motion_transitions_tool on top. `transitions:
  "none"` for a pure hard-cut chain.
- Music used as sound effects; use the SFX tools, keep the music bed whole.
- Different grades per shot: the match only works when the frames rhyme.
