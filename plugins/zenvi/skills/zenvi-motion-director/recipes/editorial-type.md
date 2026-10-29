---
id: editorial-type
kind: style
summary: Type is the picture - a brand or design study, crosshair grids, mono labels, letter swaps, flash frames
categories: [kinetic-type-motion-design, fashion-beauty-ad, brand-story-corporate]
tools: [add_kinetic_title_tool, add_motion_block_tool, add_motion_template_tool, auto_sound_design_tool]
pace: fast
mood: [designed, crisp, playful]
aspect: ["9:16", "1:1", "4:5"]
pairs_with: []
avoid_with: []
---
# Editorial / brand type

**One call first:** `produce_video_tool` `{"request": "<the brief as written>", "style": "editorial-type", "output": "output.mp4"}`
cuts this recipe with its builder, finishes, renders and reviews in one call. The rest of
this file is for layering on that cut and fixing what its review lists, or for
building by hand when no builder fits.

Type is the picture: one object (a flower, a shoe, a cookie), thin crosshair
grids with tiny mono labels, image tiles in rectangular frames, kinetic words
with letter swaps, false-colour variants, white/black flash frames. Tight
(~0.3 s cuts) for a study; bouncier and warmer for a brand piece (cream +
cobalt, letters that squash and split).

## Structure (7-10 s)

| t (s) | what | tool |
| --- | --- | --- |
| 0-1 | the object in a tile on a gridded sheet, labels decode in | `grid_background` `variant: "editorial"` + photo, `text_scramble` |
| 1-4 | tight cuts between tiles and false-colour variants, a flash every bar | clips 8-10 f, `flash_white` / `flash_black` |
| 4-6 | the word builds (BLOOM), a letter replaced by the image | `kinetic_type` with `*`, or `kinetic_headline` |
| 6-7 | second phrase (LIVING SYMMETRY), hard end | `text_scramble` `glyphs: "blocks"` |

## Tools

1. Assets: 2 stock clips + 2-3 AI stills of the same object (one false
   colour: "magenta and cyan false colour", one on a crosshair grid poster).
   False-colour variants of one photo: duplicate the clip
   (`duplicate_clips_tool`) and give each a different LUT
   (`apply_look_tool` `look_id: "warm_to_cool"`, `"teal_punch"`,
   `"color_pop"` at 1.0).
2. Sheet and type:

```json
add_motion_template_tool {"template": "grid_background", "variant": "editorial", "labels": ["LILIUM", "FIG. 01", "48°N", "SPECIMEN"], "duration_seconds": 7}
add_motion_template_tool {"template": "kinetic_type", "text": "BL*OM", "file_ids": ["<lily still>"], "position_seconds": 4, "font_family": "archivo-black", "palette": "editorial", "bpm": 108}
add_motion_block_tool {"block": "text_scramble", "position_seconds": 5.8, "duration_seconds": 1.2,
  "params": {"text": "LIVING / SYMMETRY", "glyphs": "blocks", "display_font": "mono", "palette": "mono"}}
add_motion_block_tool {"block": "hud_callouts", "position_seconds": 0.2, "duration_seconds": 3,
  "params": {"title": "LILIUM", "labels": ["Petal", "Stamen"], "values": ["6", "6"], "grid": "crosshair", "display_font": "mono"}}
```

   `crop_labels` (`template: "crop_labels"`, `labels`) frames details of the
   hero shot in labelled boxes and lifts them into tiles.
3. Cuts: 8-10 frame clips on track 1 between the tile moments;
   `apply_motion_transition_tool` `flash_white` on 2-3 downbeats and
   `glitch` once. No slides or whips: this genre cuts.
4. Sound: `auto_sound_design_tool` `intensity: "hype"`, then `add_sfx_tool`
   `keyboard_key` (or `ui_tap`) per letter swap and `glitch_burst` per flash.
5. Brand variant (playful): `kinetic_headline` `style: "pop"`, `palette:
   "cream"`, one accent (`accent: "#2340D6"`), `word_rotator` for "bake.
   crunch. share."; `pop` sounds allowed here.
6. Without headless Chrome (motion blocks refuse), or for type the desktop
   must play natively: `add_kinetic_title_tool` per phrase, `animation:
   "letters"` (Dd5-sUUoJcW: letters bounce in one by one) or `"scramble"`
   (labels and numbers decode), `"typewriter"` for HUD lines; `style:
   "stack"` (condensed capitals) or `"editorial"` (serif, italic accent).

```json
add_kinetic_title_tool {"text": "LIVING SYMMETRY", "style": "stack", "animation": "scramble",
  "position_seconds": 5.8, "duration_seconds": 1.2, "accent": "#2340D6"}
```

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 4 above (`intensity: "hype"`, `density: "every_cut"`).
2. `master_audio_tool` `{"preset": "social", "genre": "editorial", "iterate": true}` (fixes what analyze_mix_tool finds, then masters), after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

## Checks

Contact sheet reads as one designed system: one grid, one mono label size,
two families. `preview_frame` on the word build: letters inside title-safe,
the image tile aligned to the baseline.

## Pitfalls

- Mixing three typefaces: mono labels + one display, that is all.
- Labels everywhere: 3-4 tiny labels, at the corners.
- Soft transitions (dissolves): this genre is hard cuts and flashes.
