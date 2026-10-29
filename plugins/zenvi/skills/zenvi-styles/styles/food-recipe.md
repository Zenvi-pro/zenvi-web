---
id: food-recipe
kind: style
summary: "For recipes and food stories: dish first, steps cut on the knife and the pour, warm soft grade, foley above the bed."
categories: [food-recipe]
tools: [add_clip_to_timeline_tool, trim_clip_tool, gather_stock_footage_tool, add_motion_block_tool, add_kinetic_title_tool, add_timer_tool, set_clip_speed_tool, unify_grade_tool, color_grade_clip_tool, apply_fx_tool, apply_look_tool, add_vignette_tool, add_sfx_tool, search_sound_library_tool, automate_volume_tool, master_audio_tool, render_video, review_render_tool]
pace: medium
mood: [warm, cosy, satisfying, helpful]
aspect: ["9:16", "1:1", "4:5", "16:9"]
pairs_with: [overhead-hands-only-recipe-overlays, cuts-on-audio-transients, cut-on-action, slow-motion-hero-passage, soft-bloom-lifted-shadow-grade, hard-cut-chapter-title-cards, slow-pan-over-stills-or-documents, voice-over-bed-mix-balance]
avoid_with: [sentence-split-rapid-hook, vo-keyed-emphasis-stack, accelerating-cut-length-ramp, documentary-register-parody-kit]
needs: [recipe-step-overlay, action-foley-spotter, audio-onset-cut-snap, cutout-title-reveal]
---

# Food / recipe

## When to use / not
Use: a recipe short, a cook-along, a restaurant or producer story, a
chaptered food film, 15-90 s. Not for: a food product ad with a creator
(`ugc-ad-testimonial`), a restaurant promo with no cooking (`brand-story-corporate`).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-2 the finished dish (hero shot + name) · 2-12 3 steps, 2.5-3.5 s each · 12-15 hero hold + save/CTA line |
| 30 s | 0-2.5 dish · 2.5-22 4-6 steps (labels, timer on the cook) · 22-27 slow-motion hero (pour, cut, pull) · 27-30 plated hold |
| 60 s | 0-3 dish · 3-16 ingredients reveal · 16-46 steps with a prep montage (12 shots in 20 s) · 46-55 hero + tasting · 55-60 hold |
| documentary | cold open on motion (28 %) → interview anchor → prep montage → heritage stills → exit; or chapter cards (Breakfast / Lunch / Dinner) |

The dish shows in the first 3 s (genre form, `[P]`); end on a held plate, not a fade.

## Shot plan
- Prep block: alternate close, insert, wide, medium; never 3 of one scale in a
  row; inserts 0.7-1.5 s, reveal / chop holds 3-3.5 s (median 1.45 s, p90/p10 > 3).
- Cut on the knife strike or inside the gesture (`cut-on-action`).
- Hook and hero must be different shots (the judge marked a reused pour clip as
  a loop).
- Stills (heritage, menus) drift 5 %, 1.2-1.6 s each.

## Look & grade
`soft-bloom-lifted-shadow-grade`: `unify_grade_tool` warm_correction 0.45, shadows
+0.1, highlights -0.2, bloom amount 0.25 / threshold 0.78, 35 mm fine grain,
vignette 0.2. Food stays naturally saturated; one grade family for the whole piece.

## Type system
- One label system: step and ingredient together in one lower third
  (`lower_third` with `name` = ingredient line, `role` = "STEP n"); two systems
  in two places read as default templates (judge).
- Dish name and closing line in an editorial serif (`add_kinetic_title_tool`
  style editorial, rise, `text_size` 0.07-0.085).
- Chapter cards 14-22 % height for chaptered films; timer top-right on cook steps.

## Motion & transitions
Hard cuts; one slow-motion hero (0.4-0.45x); slow push on stills; no whips.

## Sound & music
Foley is the lead: knife strikes on the cuts (-10 dB, 0.5 s apart while
chopping), sizzle under the pan shot (-26 dB noise bed), pours, plates; foley at
or above the music. Acoustic or warm bed -8 dB, VO 6-14 dB above it and the bed
swelling when the VO stops. Dialogue pieces about -17 LUFS with LRA ≤ 12;
social cuts -14. Peaks ≤ -2.5 dBTP in the references.

- SFX gains are absolute, not relative to the bed: under a bed at -4 to -6 dB
  the cues vanish (the judge heard "no sound design" on examples whose cues
  were there). Bed -12 to -14, hero cues -6 to -8, then check `analyze_mix_tool`.

## Captions/VO
Optional first-person VO over the cold open; captions only for VO, small
(documentary style). Recipe text lives in the labels, not in captions.

## Tool sequence
1. `set_project_setting_tool` 1080 x 1920 30 fps.
2. Hook: dish shot 2-2.5 s + `add_kinetic_title_tool {"text": <dish>, "style": "editorial",
   "animation": "rise", "emphasis": [1 word], "text_size": 0.07, "y": 0.16}`.
3. Steps: per step a 2.8 s shot (lower_third needs 2.5 s) +
   `add_motion_block_tool {"block": "lower_third", "params": {"name": "1 cup parsley, chopped",
   "role": "STEP 1", "accent": "#f2b134"}}` + `add_sfx_tool pop -20`;
   `add_timer_tool {"mode": "count_down", ...}` on the cook step.
4. Foley: `add_sfx_tool hit_transient -10` per strike, `static -26` with
   `duration` under the pan, `search_sound_library_tool` for pours.
5. Hero: a different shot, `set_clip_speed_tool {"speed": 0.45}`; next shot at the
   receipt's end + a transient.
6. Closing hold 2.5-3 s + line ("save this for Sunday").
7. Grade (step list above) over every clip.
8. Bed with a 500 ms fade at the end; `master_audio_tool {"preset": "social",
   "iterate": true}`; `render_video`; `review_render_tool`; one fix pass.

## Finish checklist
- [ ] Dish on screen in the first 3 s; hook and hero are different shots.
- [ ] ≥ 50 % of prep cuts within 3 frames of a strike/onset.
- [ ] Foley not below the music in the prep block.
- [ ] No more than 2 consecutive shots at one scale; p90/p10 shot length > 3.
- [ ] Stills drift; title cards 2.4-3.8 s at 14-22 % height (chaptered films).
- [ ] One grade family; food naturally saturated.
- [ ] One label system; labels never over the hands' action.
- [ ] Ends on a held plate; music resolves.

## Mix-and-match
Borrow: `hard-cut-chapter-title-cards` (chaptered films), `slow-pan-over-stills-or-documents`
(heritage), `voice-over-bed-mix-balance` (VO stories).
Never: `sentence-split-rapid-hook`, word-by-word emphasis captions,
`accelerating-cut-length-ramp` on the steps (the viewer must follow them).

## Reference moments
Local only, `~/zenvi-motion/refs2/food-recipe/`: `755280751@42.8-44.5` chop-cadence
cutting; `755280751@32.5-52.2` scale-rotating prep montage; `755280751@5.9-13.5`
cut on action and warm backlit grade; `755280751@52.2` drifting stills;
`222729677@6.3` stencil chapter cards; `222729677@16.2` foley-only scene;
`73234721@44.2` slow push into a portrait.

## Example (verified)
2026-10-29, 17-18 s, 720x1280, CLI only: stock food footage (olive oil on toast
as the hook, three steps chop / oil / wok with one lower-third label system and
chop strikes, a slow-motion hero, a closing hold with "save this for Sunday"),
soft-bloom grade, acoustic bed. Pairwise watch judge against the best watched
reference window (`755280751@30-55`): v1 3.14 vs 7.86 (hero pour reused the hook
clip; two label systems; foley buried), v2 3.14 (one label system; the oil clip
reused as the hero), v3 2.95 (closing on the hook clip read as a loop; the dark
wok shot broke the recipe's world). Lessons now in the skill: hook and hero
different shots; every shot from one kitchen and one recipe; foley at or above
the bed. The judge never heard the designed chop hits as foley: real recorded
kitchen sound is the missing piece (`action-foley-spotter`).
