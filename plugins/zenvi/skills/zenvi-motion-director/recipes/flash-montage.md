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
2. Cut: `match_cut_montage_tool` with `min_frames: 3`, `max_frames: 6`,
   `flash: true`, `zoom_drift: 0.06`, `duration_seconds: 10` — it handles
   circles; shapes it cannot detect stay centred. Without a shape idea, use
   `build_reel_tool` `style: "hype"` and then shorten with
   `slice_clips_tool`, but the montage tool is closer.
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

- 0.5 s+ shots: the genre dies. Average must stay under 0.2 s.
- Every cut a flash: flashes are punctuation, about one per bar.
- Ticks too quiet: the ticking IS the music's pulse here; keep them at the
  recipe gain or 2 dB louder.
