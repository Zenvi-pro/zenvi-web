---
id: tutorial
kind: style
summary: A how-to, tips list or effect breakdown - footage in cards on grid paper, numbered steps, before/after, Save this
categories: [vfx-tutorial-breakdown, kids-education, food-recipe, tech-review]
tools: [build_reel_tool, pop_out_tool, text_behind_subject_tool, speed_ramp_tool, auto_sound_design_tool]
pace: medium
mood: [helpful, friendly]
aspect: ["9:16"]
pairs_with: []
avoid_with: []
---
# Tutorial / breakdown

**One call first:** `produce_video_tool` `{"request": "<the brief as written>", "style": "tutorial", "output": "output.mp4"}`
cuts this recipe with its builder, finishes, renders and reviews in one call. The rest of
this file is for layering on that cut and fixing what its review lists, or for
building by hand when no builder fits.

A how-to or effect breakdown packaged as a designed object: grid paper,
footage in bordered cards, numbered captions, handwritten-feel labels with
arrows, a before/after, ending on "Save this". 9:16 first. Each step 2-4 s,
always something drawing on or popping in.

## Structure (20-30 s, 9:16)

| t (s) | what |
| --- | --- |
| 0-2 | the result first (the finished effect, full frame), hook title |
| 2-4 | "How" title on grid paper |
| 4-n | one step card per step, 3 s each: footage card, numbered caption, label box + arrow |
| n-n+3 | before/after: two cards or a wipe |
| last 2 s | `end_card` `variant: "save"` |

## Tools

1. One call for the skeleton: `build_reel_tool` `style: "tutorial"`,
   `file_ids` (one clip per step, the result last), `hook`, `labels` (one
   caption per step), `words` (one label per step), `end_card_subtitle`.
2. Or step by step: `add_motion_template_tool` `template: "step_card"`,
   `file_ids: ["<step clip>"]`, `text` (caption), `step: 1`, `tag` (the label
   box), `points: [{"x": 0.62, "y": 0.4}]` (arrow target), `palette:
   "tutorial"`, `font_family: "caveat-brush"` for the hand labels, over
   `grid_background` `variant: "paper"`.
3. The effect itself, if it is a Zenvi one: build it for real on the result
   clip (`pop_out_tool` for the letterbox break-out, `text_behind_subject_tool`,
   `speed_ramp_tool`), so the "after" is genuine.
4. Before/after: two `step_card`s, or `apply_motion_transition_tool`
   `preset: "slide"` between the raw and the finished clip.
5. Sound: `auto_sound_design_tool` `intensity: "normal"`; `pop` on each
   label, `swish_airy` on each card entrance, `camera_shutter` on the
   before/after, `sparkle` on "Save this". Music light and upbeat.

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 5 above (`intensity: "normal"`).
2. `master_audio_tool` `{"preset": "social", "genre": "talking_head", "iterate": true}` (fixes what analyze_mix_tool finds, then masters), after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

## Checks

Every caption readable at phone size and out of the bottom fifth; arrows land
on the thing they name (`preview_frame grid: true`); step numbers in order.

## Pitfalls

- Opening on the title: open on the result.
- Steps without footage: every step shows the action.
- More than 6 steps in 30 s: merge them.
