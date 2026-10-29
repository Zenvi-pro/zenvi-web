---
id: talking-head-captions
kind: style
summary: "For a creator speaking to camera (advice, story, hot take): tight speech, word-synced captions, noun B-roll, punch-ins."
categories: [talking-head-captions]
tools: [remove_silence_tool, remove_words_tool, transcribe_media_tool, get_transcript_tool, split_clip_tool, set_clip_properties_tool, gather_stock_footage_tool, add_clip_to_timeline_tool, unify_grade_tool, kinetic_captions_tool, add_kinetic_title_tool, generate_subject_matte_tool, text_behind_subject_tool, add_sfx_tool, duck_under_speech_tool, master_audio_tool, review_render_tool, set_project_setting_tool, analyze_mix_tool]
pace: fast
mood: [direct, energetic, confident]
aspect: ["9:16", "4:5"]
pairs_with: [pause-free-tight-cut, karaoke-word-highlight-captions, vo-keyed-emphasis-stack, angle-switching-on-speech, ui-card-over-the-speaker, text-between-subject-layers, slide-in-pill-badge-and-name-cards, voice-over-bed-mix-balance]
avoid_with: [documentary-register-parody-kit, negative-space-chapter-breath, letter-indexed-object-then-look-cycle, slow-pan-over-stills-or-documents]
needs: [transcript-broll-inserter, word-anchored-placement, caption-chunk-phrase-break]
---

# Talking head with captions

## When to use / not
Use: one person talks to camera and the words are the product (advice,
opinion, story, a lesson, a hot take), 15-90 s vertical. Not for: an
interview with several speakers (`podcast-clip-vertical`), a product demo
(`ugc-ad-testimonial`), a voice-over over footage with no face
(`documentary-true-story`, `video-essay-explainer`).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-1.4 hook line, first cut by 1.4 · 1.4-11 claim + one example, 2 inserts · 11-15 payoff line + 1.5 s button |
| 30 s | 0-1.4 hook · 1.4-8 claim · 8-22 proof/example, insert every 5-7 s · 22-28 payoff · 28-30 CTA or resolve |
| 60 s | 0-2 hook · 2-13 claim · 13-45 proof, 7-9 inserts, one card · 45-56 payoff · 56-60 CTA |
| 90 s | as 60 s with a numbered list (3 points) in the proof, each point opening on a punch-in |

Speech fills 96-99 % of the runtime; no outro, no logo sting.

## Shot plan
- A-roll 80 % of runtime; cut on sentences: every other piece a 1.4-1.5x
  punch-in (a second camera). Holds 1.2-6.5 s, nothing over 10 s.
- B-roll inserts on trigger nouns, 0.8-1.5 s (median 1.1), muted, one every
  5-8 s, 14-20 % of runtime; each tied to the spoken word within 0.5 s, never
  reused; demonstrate the idea, not the literal word (best) or literal (OK).
- One UI/screen card over the torso for 3-6 s if there is proof to show.

## Look & grade
One grade over A-roll and inserts (`unify_grade_tool`, `warm_pop` 0.3-0.4 or
`bold_red_cinema` 0.5); every insert's mean luma within 15 of the A-roll.
Medium-high contrast, natural skin, optional edge vignette; no heavy LUT.

## Type system
- Captions: word-synced, 1-3 words per event at 5.5-7 % frame height, white
  with a dark stroke, ALL CAPS heavy sans; one accent colour.
- Hierarchy is what separates best from average: emphasis words 3-5x the
  connectors (creator style), 3-6 per 20 s, each once. Accent yellow or the
  brand colour; saturated red slabs over a face read as clutter (judge).
- Headline pill or hook line at top from 0 s (3-5 words, 3.5-4 % height).
- Placement in negative space, never on the mouth; y 0.62-0.70 without a
  matte.

## Motion & transitions
100 % hard cuts; punch-ins carry the motion. At most one whip (`direction:
"up"`) where the topic changes. Caption entrance `pop` or `tilt`; one
`text_behind_subject_tool` word at the emotional peak.

## Sound & music
Voice -14 LUFS, dry, close; bed lo-fi 78-129 bpm, 18-30 dB under (business-
advice style) or 9-10 dB under (authored reels), ducked; or no bed. A quiet whoosh
(-22 dB) on B-roll entries only, none on returns; a pop (-18 to -20 dB) on 2-3
emphasis words; at least 3 cue types, no two identical within 3 s. Master
-14 ±1 LUFS, ≤ -1 dBTP.

- SFX gains are absolute, not relative to the bed: under a bed at -4 to -6 dB
  the cues vanish (the judge heard "no sound design" on examples whose cues
  were there). Bed -12 to -14, hero cues -6 to -8, then check `analyze_mix_tool`.

## Captions/VO
The speaker's own voice, 165-180 wpm. Captions repeat the speech exactly.
No transcript (TTS or script only): cues per phrase in timeline seconds.

## Tool sequence
1. `set_project_setting_tool` width 1080 height 1920 fps 30.
2. A-roll on track 1; `remove_words_tool {"fillerPreset": "english_fillers"}`
   (after `transcribe_media_tool`), `remove_silence_tool {"clipId", "minPauseSec":
   0.35, "padSec": 0.12}`; first word at frame 0.
3. `get_transcript_tool {"includeWords": true}`; list sentence ends and 4-9
   trigger nouns.
4. `split_clip_tool` at sentence ends; `set_clip_properties_tool {"properties":
   {"scale_x": 1.4, "scale_y": 1.4, "location_y": 0.06}}` on every other piece.
5. `gather_stock_footage_tool {"queries": [<one per noun>], "orientation":
   "portrait", "count": 6, "min_seconds": 3}`; per noun `add_clip_to_timeline_tool
   {"file_id", "position_seconds": <word start>, "start_seconds", "end_seconds":
   <+1.1>, "track": 3}` (muted stock; one undo step each: `transcript-broll-inserter`
   would do it in one).
6. `unify_grade_tool {"timeline_clip_ids": [all picture], "reference_clip_id": <A-roll>,
   "look": "warm_pop", "look_intensity": 0.35}`.
7. Optional: `generate_subject_matte_tool` on the A-roll (CLI/cloud).
8. `kinetic_captions_tool {"timeline_clip_ids": [all picture], "style": "creator",
   "animation": "pop", "emphasis": [3-6 words], "text_size": 0.06, "y": 0.64,
   "placement": "style"}` (with a matte: leave `placement` and `y` out).
9. `add_kinetic_title_tool {"text": <hook topic>, "style": "creator", "emphasis":
   [1 word], "text_size": 0.05, "y": 0.14, "position_seconds": 0, "duration_seconds": 3}`.
10. Sound: `add_sfx_tool whoosh_short -22` at each insert, `pop -20` on 2-3
    emphasis words; bed with `start_seconds` past any silent intro;
    `duck_under_speech_tool {"speech_clip_ids": "<vo>", "bed_clip_ids": "<bed>", "duck_db": -10}`.
11. `master_audio_tool {"preset": "social", "genre": "talking_head", "iterate": true}`,
    `render_video`, `review_render_tool`, one fix pass.

## Finish checklist
- [ ] Emphasis : connector size ≥ 2 (best 3-5); 3-6 emphasis words, each once.
- [ ] No caption box over the face in any of 6 sampled frames.
- [ ] Every insert on a spoken noun (±0.5 s), 0.8-1.5 s, none reused.
- [ ] ≥ 3 cue types; no identical samples within 3 s; whoosh on insert entries only.
- [ ] Final beat ≥ 1.5 s that resolves the claim or gives one CTA.
- [ ] Authored < 40 s: median shot ≤ 1.5 s; no pause > 0.4 s inside a sentence.
- [ ] -14 ±1 LUFS, ≤ -1 dBTP; inserts' luma within 15 of the A-roll.

## Mix-and-match
Borrow: `karaoke-word-highlight-captions` (calmer, podcast look),
`ui-card-over-the-speaker`, `text-between-subject-layers` (once),
`sentence-split-rapid-hook` (authored hooks), `slide-in-pill-badge-and-name-cards`.
Never: `documentary-register-parody-kit` (register clash),
`negative-space-chapter-breath` (kills the pace), two caption systems at once.

## Reference moments
Local only, `~/zenvi-motion/refs2/talking-head-captions/`: `xbkl8si@1.4` first
cut and claim; `xbkl8si@18.2` and `@25.1` noun inserts; `xbkl8si@7.7`
whoosh on insert entry; `xbldiqa@12.3` digital punch-in; `xbk1h26@14.8`
emoji pop; owner reels `Dc3mgNJO73W` (3-5x emphasis hierarchy, word behind
head), `Dej3WX-s86l` (split captions clear of the face).

## Example (verified)
2026-10-29, 15-17 s, 720x1280, CLI only: one stock desk take as the A-roll
(single camera, cut on 8 sentence boundaries, 1.4x punch-in on every other
piece), four muted noun inserts (street, laptop, alarm clock, coffee) with a
whoosh on each entry, creator captions with 4 emphasis words, a hook line at
the top, lofi bed ducked, synthetic VO. Pairwise watch judge against the best
watched reference window (`xbkl8si@0-30`): v1 5.0 vs 5.5 (closest); v2 4.41
(a slammed end card and a red hook title read as clutter); v3 4.32; v4 4.82
with yellow emphasis and a quiet hook line (red slabs over the face clashed;
colour emphasis plus moderate size read better next to the reference) but a
2.6 s tail read as dead air. So: end 0.8-1.2 s after the last word on a resolve,
hook line small, emphasis in one accent. The synthetic voice is the note on
every pass; with real speech the edit grammar is what this skill encodes.
