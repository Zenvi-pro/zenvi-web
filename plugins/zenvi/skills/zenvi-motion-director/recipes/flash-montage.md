# Flash montage

A new image every 3-6 frames on one idea ("the evolution of time"), shapes
matched across cuts, glow and grain, flash frames, a glowing end word.
Reference feel: 12 s, ~0.16 s per shot, 5 flash events per 10 s, loud.

## Structure (12 s, 30 fps)

| t (s) | what | length |
| --- | --- | --- |
| 0-0.8 | one establishing image, push in | 18-24 f |
| 0.8-10 | the flash run: 50-60 images, shapes matched in pairs | 3-6 f (4 typical) |
| section starts | white flash (the run, the drop, the end title) | 3 f |
| the drop (~2/3 in) | `glitch` (RGB split) on the cut | 4-5 f |
| bar lines after the drop | `flash_invert` and `glitch`, alternating | 3-5 f |
| 10-12 | end title over black or the last image | 50-60 f |

No image back within 3 s while the bin has others: at 4 frames a shot that
is ~22 different images in the busiest 3 s, so gather plenty (stills are fine
at this speed). When the bin is short, space the repeats as far apart as the
bin allows (A B C D E F … A), never A B A. Group by shape (spirals, circles,
eyes), and inside a group keep the shape centred.

## Tools

1. Assets: **source count 20-30 clips/stills**: one
   `gather_stock_footage_tool` call with 8-10 queries (`"count": 24`,
   `"min_seconds": 2`), plus 2-4 AI stills
   (`generate_image_and_add_to_timeline_tool` writes to the timeline; move or
   delete the clip after, the file stays in the bin).
2. Cut: `match_cut_montage_tool` with `min_frames: 3`, `max_frames: 5`,
   `flash: true`, `zoom_drift: 0.06`. Give **every** file a box: the whole
   frame (`{"x": 0, "y": 0, "w": 1, "h": 1}`) with `target: {"x": 0.5, "y":
   0.5, "size": 1.333}` (16:9; 0.75 for 9:16) plays each image at its own
   framing, no zoom. Without boxes the tool hunts for circles in every image
   and zooms 4-17x into whatever it finds. Shape matches then come from
   choosing images whose spiral or circle is already centred at a similar
   size, and putting them next to each other in `file_ids`. The tool ends on
   the last downbeat before `duration_seconds`: ask for 1-2 s more than the
   run needs; its first and last shots are held, so keep the first short
   (trim it to 0.6-0.8 s) and put the end title over the last.

```json
match_cut_montage_tool {"file_ids": ["<shell>", "<galaxy>", "<ear>", "<hurricane>", "<eye>", "<fern>"],
  "subjects": [{"file_id": "<shell>", "box": {"x": 0, "y": 0, "w": 1, "h": 1}}, {"file_id": "<galaxy>", "box": {"x": 0, "y": 0, "w": 1, "h": 1}}],
  "target": {"x": 0.5, "y": 0.5, "size": 1.333},
  "music_file_id": "<track>", "duration_seconds": 12, "min_frames": 3, "max_frames": 5, "flash": true, "zoom_drift": 0.06,
  "transitions": "flash", "bpm": 160}
```

   (one subjects entry per file). Without a shape idea, `build_reel_tool`
   `style: "hype"` is the fallback (1/4-beat bursts after the drop, its own
   flashes, glitch and negative hits, display titles: skip steps 3 and 5).
3. Accents: `transitions: "flash"` (step 2) already puts `flash_invert`,
   `glitch` and a punch once a bar between the white flashes, on the shots'
   own track, never on neighbouring cuts, and flies into the last image;
   `data.transitions` lists them. The white flash frames sit on a track of
   their own: one more accent by hand goes on the **shots'** track
   (`data.tracks.video`), `apply_motion_transition_tool` `track`, `time`.
4. Look, on matched plates: `unify_grade_tool` `{"look": "dreamy_cinema",
   "look_intensity": 0.6}` (or `"night_glow"`) first, so a bright still and a
   dark one stop jumping at 4 frames a shot; then grain only:
   `apply_look_tool` `all_clips: true`, `look_id: "grain:35mm_gritty"`; then a glow:
   `add_effect_tool` `effect: "Glow"` `scope: "all"` (check the frame: bloom
   on highlights, not a white wash).
5. End title (1-2 words): `add_title_tool` `text: "THE END"`, `font: "Instrument Serif"` (or `"Anton"` for a harder edit),
   `font_scale: 1.6`, `fade_in_seconds: 0.4`, plus `add_effect_tool` Glow on
   that clip. Or `add_motion_block_tool` `block: "kinetic_headline"` with
   `style: "blur"`, `palette: "dark"`, `display_font: "serif"`.
6. Sound: `auto_sound_design_tool` `intensity: "hype"`, `density:
   "every_cut"` (a click or hit on every new image), beats from the
   receipt. Then `add_sfx_tool` `recipe: "riser_noise"` ending at the title
   (`align: "peak"`, `at_seconds` = title start) and `impact_boom` on it.

7. Review: `review_edit_tool` `pace: "fast"`; fix `clip-back-soon` and
   `repeated-footage` (more images, then rerun the cut with `replace: true`)
   and `long-hold` (nothing but the first shot and the end title over
   0.5 s). Call it again until no `high` or `medium` problem is left.

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 6 above (`auto_sound_design_tool` `intensity: "hype"`, `density: "every_cut"`).
2. `master_audio_tool` `{"preset": "social"}`, after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

## Checks

The contact sheet must show many different images; `preview_frame` on three
flash cuts (bright but not clipped to pure white for more than 2 frames), the
drop (the glitch frame shows the RGB split), the end title (readable,
centred, glow not smeared).

## Pitfalls

- 0.5 s+ shots: the genre dies. Average must stay under 0.2 s; read the
  receipt's shot list, and if the fast run covers less than 80 % of the
  piece, add files and rerun with `replace: true`.
- Soft, blown-up shots: a `scale` above 1.5 in the receipt means a file had
  no box.
- Every cut a flash: flashes are punctuation, about one per bar after the
  drop, one per section before it.
- Ticks too quiet: the ticking IS the music's pulse here; keep them at the
  recipe gain or 2 dB louder.
