---
id: vfx-tutorial-breakdown
kind: style
summary: "For VFX breakdowns and how-to reels: result first, labelled before/after, step cards, the result again last."
categories: [vfx-tutorial-breakdown]
tools: [add_clip_to_timeline_tool, add_shape_mask_tool, set_clip_properties_tool, color_grade_clip_tool, apply_look_tool, pop_out_tool, add_kinetic_title_tool, add_motion_template_tool, add_motion_block_tool, kinetic_captions_tool, add_sfx_tool, duck_under_speech_tool, master_audio_tool, render_video, review_render_tool]
pace: medium
mood: [clever, helpful, revealing, playful]
aspect: ["9:16", "16:9"]
pairs_with: [object-pop-out-with-clean-plate-swap, comic-burst-insert, tutorial-packaging-kit, split-screen-compare-layout, screen-capture-zoom-onto-the-number, sound-cue-per-graphic-or-ui-event]
avoid_with: [withheld-music-cold-drop, beat-staggered-tile-and-slice-build, commentary-hits-with-dense-designed-cues]
needs: [layer-pass-wipe, split-compare, screen-zoom-follow, tracked-object-matte, comic-burst-card]
---

# VFX tutorial / breakdown

## When to use / not
Use: a before/after of a shot, a layer-pass breakdown (plate → matte →
comp), a "how I made this" reel, a tool tutorial with steps, 20-60 s. Two
modes: **A, breakdown** (the picture carries it, compare devices, little
type) and **B, packaged tutorial** (host or VO over screen captures, step
cards, captions, dense UI sound). Not for: a software launch film
(`saas-app-launch`), a talking-head explainer without footage
(`talking-head-captions`).

## Structure
| Length | Beats |
| --- | --- |
| 20 s | 0-2.5 the finished shot, no explanation · 2.5-7.5 labelled A/B split · 7.5-10.5 unsplit replay with one accent (burst) · 10.5-17.5 step card + proof number · 17.5-22 the result again, longest, + CTA |
| 30 s | hook 0-2.5 · compare by 2-6 s · 2-3 alternations of compare → result (each 2-9 s) · one reaction or host beat (1-1.7 s) · steps 4-7 s each · CTA in the last 10 % |
| 60 s | hook · 3 breakdown stages per reveal, 1.4-1.9 s apart · clean replays 4.5, 5.9, then 7.4 s (the last longest) · logo or CTA 5-10 % |

The compare device appears by 2.2 s (median); the result is shown first and
last, unsplit, and the last replay is the longest.

## Shot plan
- Locked-off frames for every compare (the eye compares content only).
- Original always first (top or left), fixed second; frame-locked copies.
- Screen captures of the comp/app for 4-7 s, with a push-in onto the control
  being discussed.
- One human beat (host, crew reaction) every 15-20 s in mode B.

## Look & grade
No house grade: the grade is the work. The packaging is neutral: either dark
UI with one neon accent, or high-key paper/grid. One accent colour repeated on
pills, badges and emphasis words.

## Type system
Three tiers: captions 4.5-5 % (`kinetic_captions_tool`), step headers / labels
6-10 % (`step_card`, `add_kinetic_title_tool creator`), a hero number ~8 %+
(`counter`). Compare labels: one casing (lowercase bold "original" / "fixed")
in a fixed position on every split. Emphasis by the accent colour, not size.

## Motion & transitions
Mode A: hard cuts; the only moving device is the wipe or split (travel ~1.2 s,
hairline edge held 1.7-3.5 s). Mode B: the motion-design toolbox (zoom-through,
whip, flash, glitch) between steps, 1 per step. A playful accent per 5-10 s at
most (`comic-burst-insert`, `object-pop-out-with-clean-plate-swap`).

## Sound & music
- Mode B: a cue on every on-screen event (24+ per minute): click on menus,
  keyboard on typing, whoosh on card moves, pop on badges, riser under the
  number, a punch when it lands, a stinger on the end card.
- Mode A: diegetic first (impacts in the shot), a whoosh on each wipe pass,
  one silence before the logo.
- Bed lo-fi/electronic 115-128 bpm, VO 5-12 dB over it, master -14 LUFS.

## Captions/VO
Mode B VO is fast (145-178 wpm, close-mic); word captions at 4.5-5 % with
keywords in the accent. Mode A: no captions; labels only.

## Tool sequence
1. Hook: the finished clip; `pop_out_tool {"band_aspect": 0.8}` on 9:16 (a
   1.4 band leaves the hook frame mostly black) + a one-line claim title.
2. Split: the same clip twice (tracks 1 and 2, same in/out),
   `add_shape_mask_tool {"y": 0.5, "width": 1.0, "height": 0.495}` on both,
   then `set_clip_properties_tool location_y` -0.25 / +0.25 (the mask is drawn
   in the clip's frame: mask the centre, then move). Grade only the "fixed"
   copy. Labels: `add_kinetic_title_tool {"style": "creator", "emphasis": "none"}`
   at y 0.05 and 0.55 (with the label as its own emphasis both landed in one spot).
3. Replay unsplit + `comic-burst-insert` on the hit.
4. `add_motion_template_tool grid_background paper` + the screen/host clip
   (`corner_radius` 0.06, scale 0.86) + `step_card` showing the shot being
   fixed (not unrelated footage).
5. A second step card, or a `counter` block (`exit: false`, riser + punch) only
   when the number is this tutorial's proof (an off-topic number read as filler).
6. The result again, longest, + CTA title (comment keyword), boom + tail.
7. Sound: one cue per event (list in the example), bed -15, master.
8. Render; `review_render_tool`.

A real wipe through layer passes with a hairline edge (`layer-pass-wipe`), a
one-call split with divider (`split-compare`), automatic screen zoom-follow
(`screen-zoom-follow`) and object mattes (`tracked-object-matte`) are gaps.

## Finish checklist
- [ ] Compare device by 2-6 s; the result shown first and last, unsplit, last replay longest.
- [ ] 2-3 stages per reveal, 1.4-1.9 s apart (breakdown mode).
- [ ] One label casing and order on every split; each pass named.
- [ ] Step footage matches the step's words.
- [ ] 24+ cues/min in mode B; VO 5-12 dB over the bed; -14 LUFS.
- [ ] One accent colour; three type tiers.
- [ ] Pace: 1.3-2.3 s median shot in packaged reels.
- [ ] The ending resolves (CTA held, a hit and tail), not a cut mid-clip.

## Mix-and-match
Borrow: `object-pop-out-with-clean-plate-swap`, `comic-burst-insert`,
`tutorial-packaging-kit`, `split-screen-compare-layout`,
`screen-capture-zoom-onto-the-number`, `prompt-bar-typing-hero` (AI tool
tutorials). Never: withheld-music structures, hype commentary, unifying the
grade of the before/after.

## Reference moments
Local only, `~/zenvi-motion/refs2/vfx-tutorial-breakdown/`:
`1603808573615910912@3.2` layer-pass wipe; `1603808573615910912@62.6` silence →
drawn ring logo; `1149797773434208256@2.2` labelled A/B split;
`1149797773434208256@46.4` the longest clean replay; `1149797773434208256@10.9`
crew reaction; `1518317247193780224@11.2` comic bursts; `1592274074473877505@4.5`
print-shader title.

## Example (verified)
2026-10-29, 22.2 s, 720x1280, CLI only (`.../styles/vfx-tutorial-breakdown/`):
the finished pop-out jump first (`pop_out_tool band_aspect 0.8`) with "this
jump is fake"; a frame-locked original/fixed split of the same jump (flat vs
`teal_&_orange_cinema`, lowercase labels); the pop-out replay with a "BOOM"
burst on the landing; two `step_card`s over a rounded screen container on
grid paper; the result again, longest, with "comment BARS for the file" and a
boom + tail; a cue on every event (19), groove bed, mastered.
Pairwise judge vs `1518317247193780224@0-25` (Batman before/after): v1 7.27
vs 3.27 but absolute 3.09 (hook mostly black bars; the compare used a
basketball clip unrelated to the jumper; a photo-retouching screen as "step
1"), v4 6.68 vs 5.41, tie, absolute 4.55 (one subject through the piece, a
taller band, a second step card instead of an off-topic counter). Remaining
judge note: the steps show the loop again instead of real matte passes —
stock cannot supply them (`layer-pass-wipe`). Found on the way: a creator
title with its own word as `emphasis` ignored `y` and two labels overlapped;
use `emphasis: "none"` for labels.
