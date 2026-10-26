# Flash montage

A new image every 3-6 frames on one idea ("the evolution of time"), shapes
matched across cuts, glow and grain, flash frames, a glowing end word.
Reference feel: 12 s, ~0.16 s per shot, 5 flash events per 10 s, loud.

## Structure (12 s, 30 fps)

| t (s) | what | length |
| --- | --- | --- |
| 0-0.8 | one establishing image, push in | 18-24 f |
| 0.8-10 | the flash run: 50-60 images, shapes matched in pairs | 3-6 f (4 typical) |
| every bar | `flash_white` or `flash_invert` | 3 f |
| 10-12 | end title over black or the last image | 50-60 f |

Images can repeat (A B C A D B...): the eye reads rhythm, not novelty. Group
by shape (spirals, circles, eyes), and inside a group keep the shape centred.

## Tools

1. Assets: 10-16 clips/stills over 6-8 searches plus 2-4 AI stills
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
  "music_file_id": "<track>", "duration_seconds": 12, "min_frames": 3, "max_frames": 5, "flash": true, "zoom_drift": 0.06}
```

   (one subjects entry per file). Without a shape idea, `build_reel_tool`
   `style: "hype"` is the fallback, but it cuts slower.
3. Extra flashes: `apply_motion_transition_tool` `preset: "flash_invert"` on
   3-4 cuts that land on downbeats (`track`, `time`), `glitch` on one.
4. Look: `apply_look_tool` `look_id: "dreamy_cinema"` or `"night_glow"`,
   `all_clips: true`, `lut_intensity: 0.6`, grain `35mm_gritty`; then a glow:
   `add_effect_tool` `effect: "Glow"` `scope: "all"` (check the frame: bloom
   on highlights, not a white wash).
5. End title: `add_title_tool` `text: "THE END"`, `font: "Instrument Serif"`,
   `font_scale: 1.6`, `fade_in_seconds: 0.4`, plus `add_effect_tool` Glow on
   that clip. Or `add_motion_block_tool` `block: "kinetic_headline"` with
   `style: "blur"`, `palette: "dark"`, `display_font: "serif"`.
6. Sound: `auto_sound_design_tool` `intensity: "hype"`, beats from the
   receipt. Then `add_sfx_tool` `recipe: "riser_noise"` ending at the title
   (`align: "peak"`, `at_seconds` = title start) and `impact_boom` on it.

## Checks

The contact sheet must show many different images; `preview_frame` on three
flash cuts (bright but not clipped to pure white for more than 2 frames), the
end title (readable, centred, glow not smeared).

## Pitfalls

- 0.5 s+ shots: the genre dies. Average must stay under 0.2 s; read the
  receipt's shot list, and if the fast run covers less than 80 % of the
  piece, add files and rerun with `replace: true`.
- Soft, blown-up shots: a `scale` above 1.5 in the receipt means a file had
  no box.
- Every cut a flash: flashes are punctuation, about one per bar.
- Ticks too quiet: the ticking IS the music's pulse here; keep them at the
  recipe gain or 2 dB louder.
