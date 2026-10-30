---
id: fitness-lifestyle
kind: style
summary: "For training, sport-at-home and lifestyle shorts: cold open on action, cuts on the strike, real foley, one held breath."
categories: [fitness-lifestyle]
tools: [add_clip_to_timeline_tool, trim_clip_tool, gather_stock_footage_tool, unify_grade_tool, speed_ramp_tool, align_match_cut_tool, add_kinetic_title_tool, add_sfx_tool, search_sound_library_tool, automate_volume_tool, master_audio_tool, render_video, review_render_tool, watch_clip_window_tool, set_project_setting_tool, analyze_mix_tool]
pace: medium
mood: [focused, energetic, aspirational, deadpan]
aspect: ["9:16", "16:9", "4:5"]
pairs_with: [cuts-on-audio-transients, cut-on-action, motion-pose-or-position-match-cut, negative-space-chapter-breath, slow-motion-with-anchored-subject-tracking, blackout-and-dead-silence-pause, voice-over-bed-mix-balance, documentary-register-parody-kit, whip-transition-motion-blur-smear]
avoid_with: [karaoke-word-highlight-captions, vo-keyed-emphasis-stack, sentence-split-rapid-hook, multi-panel-and-card-video-layout]
needs: [audio-onset-cut-snap, action-foley-spotter, tracked-point-hold-reframe]
---

# Fitness / lifestyle

## When to use / not
Use: workouts, training montages, running, yoga, a day-in-the-life with a
physical craft, deadpan lifestyle comedy, 20-70 s. Not for: a coach talking
to camera with tips (`talking-head-captions`), a supplement ad (`ugc-ad-testimonial`),
a hype edit to a drop (`sports-hype-edit`).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-0.5 action at frame 0 · 0.5-9 process montage, 1-1.8 s shots · 9-11 breath · 11-15 hero move + held end |
| 30 s | 0-2 cold open on action · 2-14 process (tight, cut on the strike) · 14-16 breath plate · 16-26 escalation / vantage change, longer shots · 26-30 held button |
| 60 s | 0-2 open · 2-20 process (mean 1.8 s) · 20-23 breath · 23-42 escalation (mean 4-6 s) · 42-54 payoff · 54-60 button (8 s hold or cut on action) |

Pace changes with the beat: the first third cuts at about 1.8 s mean, the last
third at 4-6 s (the best piece's two regimes).

## Shot plan
- Macro of the tool or body part first (laces, plates, gloves, an ankle), then
  the wider shot for geography.
- Cut on the physical event: the strike, the lift lockout, the foot strike.
- One match cut on a shared path or pose (runner to runner), one slow-motion
  hero take, 1-3 whips at most (none in the example: the synthetic whip
  between two static shots read as jarring).
- 90-100 % hard cuts; effect transitions under 10 % of cuts.

## Look & grade
Warm daylight or moody gym, one or the other: `unify_grade_tool
{"look": "warm_correction", "look_intensity": 0.35}` over every clip; no clip
with milky blacks next to punchy ones.

## Type system
Minimal and centred, not animated: 5-10 % of runtime, 3.5-7 % height, one
light face (`add_kinetic_title_tool` style documentary, `text_size` 0.065-0.07;
0.045-0.05 rendered too small on 9:16). No captions unless a VO speaks.

## Motion & transitions
Real camera moves; speed ramp the hero (`speed_ramp_tool` hero 0.35-0.4).
Hard cuts carry the energy.

## Sound & music
Foley above the bed (0 dB or more vs music): cloth on laces, a clank + transient
on plates, a punch on pads, footsteps, breath; varied seeds, -10 dB hero, -16
transient layer. Music steady (groove, 90-110 bpm) or a calm bed against
frantic content; dip 10-14 dB on the breath plate; one near-silent window
(4+ frames) in the last 15 % for comedy or hype (`blackout-and-dead-silence-pause`).
VO, if any, 12+ dB over the bed. -14 LUFS, ≤ -1 dBTP.

- SFX gains are absolute, not relative to the bed: under a bed at -4 to -6 dB
  the cues vanish (the judge heard "no sound design" on examples whose cues
  were there). Bed -12 to -14, hero cues -6 to -8, then check `analyze_mix_tool`.

## Captions/VO
Usually none. Parody: hushed narrator (`documentary-register-parody-kit`).
Coach VO: short lines, captions as `karaoke` small, or none.

## Tool sequence
1. `set_project_setting_tool` 1080 x 1920 30 fps.
2. `gather_stock_footage_tool {"queries": [<macro tool>, <the action>, <wide>, <sky>, <hero move>],
   "orientation": "portrait", "count": 10}` or the user's footage.
3. Process block: `add_clip_to_timeline_tool` per shot 1-1.8 s, in-points on
   the strike (`preview_frame` / `watch_clip_window_tool`).
4. Match cut: `align_match_cut_tool` with boxes from a `preview_frame` grid.
5. Breath: sky plate 1.9 s + `add_kinetic_title_tool` documentary rise 0.07.
6. Hero: `speed_ramp_tool {"preset": "hero", "slow": 0.4}`; place the next shot
   at the length the receipt gives.
7. `unify_grade_tool` over everything.
8. Foley: `add_sfx_tool` per action (cloth, impact_thud, impact_punch +
   hit_transient), `search_sound_library_tool` for footsteps or breath.
9. Bed: `automate_volume_tool {"shape": "dip", "db": -12}` over the breath; fade
   out on the final hold; `master_audio_tool {"preset": "social", "iterate": true}`;
   render; review; one fix pass.

## Finish checklist
- [ ] Subject or action on screen within the first 2 s (hook latency 0).
- [ ] First-third mean shot vs last-third mean differs by 2x or more.
- [ ] Half the cuts within 2 frames of a transient (the clip's own or a foley).
- [ ] Foley at or above the bed; one deliberate silence near the end.
- [ ] Effect transitions < 10 % of cuts, each motivated by motion.
- [ ] One match cut with the subject in the same screen position.
- [ ] On-screen text < 10 s per 60 s, one family.
- [ ] Ending: a 5+ s hold or a cut on action, never a fade over a montage.
- [ ] ≤ -1 dBTP; VO ≥ 12 dB over the bed.

## Mix-and-match
Borrow: `documentary-register-parody-kit` (comedy), `blackout-and-dead-silence-pause`,
`slow-motion-with-anchored-subject-tracking`, `negative-space-chapter-breath`.
Never: word-by-word caption systems (`karaoke-word-highlight-captions`,
`vo-keyed-emphasis-stack`) on a music-led piece; grid layouts.

## Reference moments
Local only, `~/zenvi-motion/refs2/fitness-lifestyle/`: `863578151@0-20` action-onset
craft montage; `863578151@29.8` whip hand-off; `863578151@53` snap, silence,
stampede; `139460247@11.2` prop-path match cut; `139460247@31.2` sky breath;
`139460247@46.8` slow-motion hero; `712599017@8.7-28.7` deadpan angle cuts on
the punchline; `712599017@6.8` calm bed under a fast voice.

## Example (verified)
2026-10-29, 17.6-20 s, 720x1280, CLI only, no VO: stock training footage, a cut
on every strike with foley, a runner-to-runner match cut (`align_match_cut_tool`
with preview-grid boxes), a 1.5 s sky breath with "rest is training", a 0.4x
hero stretch, a held end with "6 a.m. club", groove bed dipped on the breath.
Pairwise watch judge against the best watched reference window
(`863578151@0-30`): v1 3.32 vs 7.5 (bed buried the foley, synthetic whip read as
jarring), v2 3.0 (louder cues still under a -4 dB bed), v3 2.77 (gym and outdoor
clips together read as mismatched; repeated shots), v4 3.0 vs 7.64 (one outdoor
world, no repeats, bed -12, cues -6 to -14). The judge's remaining notes were a
grade spread across eight stock sources and plain type; it also "heard" a
synthetic voice in this no-VO cut because the brief mentioned one, so keep
judge briefs specific to the piece.
