# Showreel / personal intro

A designer's or studio's intro: a grid of project tiles that zooms into one,
a 3D letter or object tumbling in, the name assembling, a word rotator
("Finding / Building / Creating"), hyperspace or burst into a white flash.
Confident, fast-in long-settle motion, one signature colour.

## Structure (10-15 s)

| t (s) | what | tool |
| --- | --- | --- |
| 0-1.5 | a dot / ring grows, bursts into lines, white flash | `particle_burst` (`shape: "lines"`) + `flash_white` |
| 1.5-4 | 3D initial or word tumbles in, light sweeps | `add_3d_scene_tool` `title_3d` (`style: "chrome"`, `animation: "tumble"`) |
| 4-7 | the name, then what they do | `kinetic_headline` `style: "rise"`, `word_rotator` |
| 7-11 | project tiles fill, camera pushes into one | `grid` `zoom_into` |
| 11-13 | that project full frame, then the end card | `end_card` `variant: "plain"` |

## Tools

1. 3D (CLI with Blender): a draft, check it, then `rerender_3d_scene_tool`
   `quality: "final"`. Without Blender: `kinetic_headline` `style: "pop"`
   with `display_font: "display"`.

```json
add_3d_scene_tool {"scene": "title_3d", "quality": "draft", "position_seconds": 1.5, "duration_seconds": 2.5,
  "params": {"text": "M", "style": "chrome", "animation": "tumble", "accent": "#FF5A36"}}
```
2. Name and role:

```json
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 4, "duration_seconds": 1.6,
  "params": {"text": "Maya *Reyes*", "style": "rise", "emphasis": "display", "palette": "dark"}}
add_motion_block_tool {"block": "word_rotator", "position_seconds": 5.6, "duration_seconds": 2,
  "params": {"prefix": "I turn ideas into", "words": ["films", "brands", "motion"], "style": "slot", "palette": "dark"}}
```

3. Work grid: `add_motion_template_tool` `template: "grid"`, `tiles: 6`,
   `file_ids` (project clips), `zoom_into: 3`, `reveal: "pop"`, with `beats`.
4. Sound: `riser_tonal` into the flash, `impact_boom` on it (the one boom),
   `whoosh_rise` on the 3D tumble, `ui_tap` per tile, `whoosh_long` on the
   zoom-into. Music: punchy electronic, full level.

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 4 above, then `auto_sound_design_tool` `{"intensity": "normal"}` for the cuts it did not cover.
2. `master_audio_tool` `{"preset": "social", "genre": "editorial", "iterate": true}` (fixes what analyze_mix_tool finds, then masters), after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

## Checks

The 3D title's final frame sharp and centred; the rotator's words never
overlap the prefix (`preview_frame` mid-switch); the zoomed tile ends exactly
full frame.

## Pitfalls

- Three signature moments: pick one (the 3D letter or the zoom-into) and keep
  the rest plain.
- Long logo hold at the start: under 1.5 s before the first real content.
