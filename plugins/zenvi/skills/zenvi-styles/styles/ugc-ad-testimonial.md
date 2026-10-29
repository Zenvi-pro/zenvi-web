---
id: ugc-ad-testimonial
kind: style
summary: "For a creator-style product ad or testimonial: hook in 3 s, real demo actions, proof as a number, one CTA."
categories: [ugc-ad-testimonial]
tools: [add_clip_to_timeline_tool, trim_clip_tool, split_clip_tool, search_clip_scenes_tool, remove_silence_tool, set_clip_properties_tool, kinetic_captions_tool, add_kinetic_title_tool, add_motion_block_tool, set_keyframes_tool, unify_grade_tool, add_sfx_tool, spot_sound_tool, duck_under_speech_tool, master_audio_tool, render_video, review_render_tool]
pace: fast
mood: [honest, energetic, persuasive]
aspect: ["9:16", "4:5"]
pairs_with: [circular-problem-to-proof-bookend, action-per-cut-micro-demo-with-live-foley, screen-capture-zoom-onto-the-number, split-screen-compare-layout, text-between-subject-layers, karaoke-word-highlight-captions, pause-free-tight-cut]
avoid_with: [negative-space-chapter-breath, letter-indexed-object-then-look-cycle, documentary-register-parody-kit, slow-pan-over-stills-or-documents]
needs: [word-anchored-placement, social-post-frame, video-card-cascade-layout]
---

# UGC ad / testimonial

## When to use / not
Use: a product (skincare, drink, gadget, app) sold by a person who uses it:
creator ads, testimonials, TikTok-shop style, 13-40 s. Not for: a polished
brand film with no person (`product-launch-film`), a review with a verdict
(`tech-review`).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-2 problem or bold claim (2-3 cuts < 1 s) · 2-9 demo, one action per 1-1.5 s · 9-12 proof (result, number) · 12-15 one CTA |
| 30 s | 0-3 hook · 3-8 problem / relatable pain · 8-17 demo · 17-26 proof (number, before/after, reaction) · 26-30 CTA stamp |
| 60 s | as 30 s with 2-3 customer micro-cases in the proof (3-5 s each) |

Hook done by 3.3 s; CTA in the last 12-16 %; the CTA repeats the hook's gesture
or words. No self-introduction before the ad.

## Shot plan
- Every shot is a new action or a new proof object; no two consecutive shots
  show the same thing. Evidence changes every 0.8-1.5 s in demo and proof.
- Close + extreme close about 55 % (hands, product, skin); talking selfie
  25-40 %; at most one wide.
- One talent for every talking beat (the judge marked a version mixing three
  different women as "breaking narrative trust").
- Talking-head holds 0.5-2 s between inserts; punch-in 1.1-1.2x on alternate
  takes.

## Look & grade
One hue family (peach/cream for beauty, cyan/slate for tech):
`unify_grade_tool {"look": "warm_pop", "look_intensity": 0.3}`; luma stable; no
blown phone highlights (lower highlights -0.2).

## Type system
- Word-replace captions 5.5-7 % with emphasis 2-3x (creator style), 2-6 words,
  emphasis uppercase in a soft accent (peach, coral) rather than saturated red:
  the judge found red slabs over beauty footage clashing.
- Proof numbers huge (counter or zoom onto the number).
- CTA keyword stamped big with a spring (0 → 115 → 98 → 100 % over 12 frames).

## Motion & transitions
Hard cuts; one whip or glitch at most for the single world change; product
logo pop on its name (0 → 110 → 100 % in 6 frames).

## Sound & music
Voice 8-12 dB over a bed, ducked (or no bed for foley-led demos). A designed
cue on every graphic entrance (13-22 cues/min in the best): pop on badges,
click on cards, material foley on each demo action, a hit 3-6 dB above the
voice on the CTA stamp. -14 LUFS, ≤ -1 dBTP.

- SFX gains are absolute, not relative to the bed: under a bed at -4 to -6 dB
  the cues vanish (the judge heard "no sound design" on examples whose cues
  were there). Bed -12 to -14, hero cues -6 to -8, then check `analyze_mix_tool`.

## Captions/VO
First person, conversational, 170-190 wpm; one claim per sentence; the proof
as a number or a visible artefact, never an adjective.

## Tool sequence
1. `set_project_setting_tool` 1080 x 1920 30 fps; selfie takes on track 1,
   `remove_silence_tool` (0.35 / 0.12).
2. Hook: problem macro or claim, 2-3 cuts < 1 s (`add_clip_to_timeline_tool`
   with in-points on the action; `circular-problem-to-proof-bookend`).
3. Demo: one action per shot 1.1-1.6 s (`search_clip_scenes_tool` to find
   them), material foley per cut (`add_sfx_tool` pop / cloth / paper /
   library pours at -10 to -16).
4. Proof: `split-screen-compare-layout`, `screen-capture-zoom-onto-the-number`
   or `add_motion_block_tool {"block": "counter"}`.
5. `unify_grade_tool` over every clip.
6. `kinetic_captions_tool {"style": "creator", "animation": "pop", "accent": "#ffb38a",
   "emphasis": [3-5 words], "text_size": 0.056, "y": 0.66, "placement": "style"}`
   over the talking and demo clips, cues up to the CTA.
7. CTA: `add_kinetic_title_tool {"text": "comment GLOW", "style": "creator",
   "animation": "pop", "emphasis": ["GLOW"], "y": 0.5}` + `add_sfx_tool impact_punch -10`.
8. Bed past its silent intro; `duck_under_speech_tool {"speech_clip_ids": "<vo>",
   "bed_clip_ids": "<bed>", "duck_db": -10}`; `spot_sound_tool` for uncued graphics;
   `master_audio_tool {"preset": "social", "iterate": true}`; render; review; fix.

## Finish checklist
- [ ] Hook inside 3.3 s; no intro.
- [ ] Demo/proof shots 0.8-1.5 s, each new information.
- [ ] A cue on every graphic entrance; foley on every demo action.
- [ ] Voice 8-12 dB over the bed.
- [ ] Captions 5.5-7 %, emphasis 2-3x, never dropped during the demo.
- [ ] Proof on screen as a number or artefact.
- [ ] Exactly one CTA in the last 12-16 %, stamped with a hit.
- [ ] One hue family; -14 LUFS, ≤ -1 dBTP; one talent for talking beats.

## Mix-and-match
Borrow: `text-between-subject-layers` once at the peak, `ui-card-over-the-speaker`
for app proof, `karaoke-word-highlight-captions` for a calmer read.
Never: `negative-space-chapter-breath` (kills the 3 s hook pace),
`documentary-register-parody-kit`, two CTAs.

## Reference moments
Local only, `~/zenvi-motion/refs2/ugc-ad-testimonial/`: `DbwNCyOugEX@0` and `@9.9`
scrape-proof bookend; `DZYMnxEBR1f@31-44.8` action-per-cut demo with foley;
`DZYMnxEBR1f@3.7` client email card; owner reels `DaMAQQCgxBL@0-6.2` punch-in
captions, `@11.8` proof-metric zooms, `@31.8` CTA stamp; `DcgslJ8MmdR@3.3` card
cascade, `@19.3` before/after cards; `Dc3mgNJO73W@11.9` word behind the speaker.

## Example (verified)
2026-10-29, 10.5-14 s, 720x1280, CLI only: stock skincare footage (three
face-wash hook cuts, selfie talking beats, dropper / cream / tray demo with
material foley), creator captions in a peach accent, "comment GLOW" stamp with a
punch, lofi bed ducked, synthetic female VO. Pairwise watch judge against the
best watched reference (`DbwNCyOugEX`, 13.5 s): v1 4.09 vs 5.45 (giant red
emphasis over the footage, three different women talking); v2 4.09 vs 5.82
(one talent, calmer accent, a proof beat); v3 3.77 vs 6.05 (smaller CTA, more
B-roll; the opening still low energy). What held: one talent, peach accent,
foley per action. What the stock could not give: a macro problem/proof pair and
a real testimonial voice; with those the structure above is the fix the judge
kept asking for.
