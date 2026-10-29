---
id: podcast-clip-vertical
kind: style
summary: "For a 30-90 s vertical cut of a podcast or interview: one story, picture follows the voice, karaoke captions, name card."
categories: [podcast-clip-vertical]
tools: [transcribe_media_tool, get_transcript_tool, diarize_media_tool, remove_silence_tool, split_clip_tool, set_clip_properties_tool, swap_shot_tool, kinetic_captions_tool, add_kinetic_title_tool, add_motion_block_tool, add_clip_to_timeline_tool, add_sfx_tool, duck_under_speech_tool, master_audio_tool, review_render_tool, edit_captions_tool, set_project_setting_tool, unify_grade_tool, analyze_mix_tool]
pace: medium
mood: [conversational, candid, informative]
aspect: ["9:16"]
pairs_with: [karaoke-word-highlight-captions, angle-switching-on-speech, slide-in-pill-badge-and-name-cards, sentence-split-rapid-hook, ui-card-over-the-speaker, pause-free-tight-cut, voice-over-bed-mix-balance]
avoid_with: [vo-keyed-emphasis-stack, accelerating-cut-length-ramp, documentary-register-parody-kit, hard-cut-chapter-title-cards]
needs: [auto-reframe-9x16, speaker-angle-switch]
---

# Podcast clip, vertical

## When to use / not
Use: a long conversation (podcast, interview, panel, street interview) to be
cut into one 30-90 s vertical story. Not for: a scripted solo piece to camera
(`talking-head-captions`), a montage with VO (`documentary-true-story`).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-0.5 statement mid-thought · 0.5-4 context headline · 4-13 the one story beat · 13-15 the line that lands |
| 30 s | 0-3 strongest sentence (the claim) · 3-20 setup and turn · 20-28 the answer / punchline · 28-30 1.4 s end card |
| 60 s | 0-3 claim · 3-45 story with 2-3 speaker turns, a visual change every 2-8 s · 45-58 payoff · 58-60 end card |
| 90 s | as 60 s with one listener reaction and one wide reset every 10-20 s |

Pick the excerpt so it resolves: the clip ends on the answer, not on the
cliffhanger (the judge marked a version that stopped at "three of them said
the same thing" down for exactly that).

## Shot plan
- One feed: a punch-in ladder, medium ↔ close (1.4-1.6x) on phrase ends
  every 2-8 s; no shot over 10 s.
- Two or more cameras: cut to whoever starts talking within 0.2 s of the first
  word (`diarize_media_tool`), reaction shot (listener laughing) during the
  punchline, a wide set reset every 10-20 s.
- One object insert when a concrete thing is named, 1.5-2.5 s.
- 16:9 source: centre the active speaker in a 9:16 crop (`auto-reframe-9x16` is
  missing: `set_clip_properties_tool` scale and location_x by hand per turn).

## Look & grade
The studio's own look; `unify_grade_tool` across cameras only. No creative LUT.

## Type system
- Karaoke captions: 2-4 word caps chunks at 4.5-6.5 % height, white, the active
  word yellow, about 65 % down, clear of mouth and UI (`text_size` 0.08, `y` 0.66).
- Context headline from 0.3-0.5 s for 4 s, top, 3.5-4.5 % height, quieter face
  (documentary/rise) so it does not fight the captions.
- Speaker name card on the turn, in the upper third when captions own the
  lower third (move the block's clip with `location_y` -0.42).
- End card 1.4 s: black, brand or show name popping in at about 7 % height.
- Brand bug and captions in disjoint zones; no two text elements overlap.

## Motion & transitions
Hard cuts only. Name card slides; captions snap. No whips, no zooms.

## Sound & music
Clean dialogue, -14 LUFS, ≤ -1 dBTP. Either no bed or a continuous low bed
15-25 dB under the voice so pauses never expose room tone; ducked. A whoosh at
-22 dB on the name card and on inserts; a soft thud on the end card.

- SFX gains are absolute, not relative to the bed: under a bed at -4 to -6 dB
  the cues vanish (the judge heard "no sound design" on examples whose cues
  were there). Bed -12 to -14, hero cues -6 to -8, then check `analyze_mix_tool`.

## Captions/VO
The guests' own words; fix misheard names with `edit_captions_tool`. Tighten
pauses (`remove_silence_tool` 0.35 / 0.12) but keep laughs.

## Tool sequence
1. `set_project_setting_tool` 1080 x 1920, 30 fps.
2. `transcribe_media_tool`, `get_transcript_tool {"includeWords": true}`;
   pick the excerpt (claim → turn → answer); trim to it.
3. `remove_silence_tool {"clipId", "minPauseSec": 0.35, "padSec": 0.12}`.
4. Ladder: `split_clip_tool` at phrase ends; `set_clip_properties_tool {"properties":
   {"scale_x": 1.5, "scale_y": 1.5, "location_y": 0.1}}` on every other piece
   (or `swap_shot_tool` to the other camera).
5. One insert: `add_clip_to_timeline_tool {"track": 3, ...}` 1.5-2.5 s at the noun.
6. `kinetic_captions_tool {"style": "karaoke", "emphasis": [4-6 words], "text_size": 0.08,
   "y": 0.66, "placement": "style"}` over all picture clips.
7. `add_kinetic_title_tool {"text": <headline>, "style": "documentary", "animation": "rise",
   "text_size": 0.062, "y": 0.12, "position_seconds": 0.3, "duration_seconds": 4}`.
8. `add_motion_block_tool {"block": "lower_third", "params": {"name", "role", "accent"}}`
   at the first turn, then `set_clip_properties_tool` location_y -0.42 on its clip.
9. End card: `add_kinetic_title_tool {"text": <show>, "style": "stack", "animation": "pop",
   "background": "#0d0d0d", "duration_seconds": 1.4}` + `add_sfx_tool impact_thud -16`.
10. Bed (optional) with `duck_under_speech_tool {"speech_clip_ids": "<vo>",
    "bed_clip_ids": "<bed>", "duck_db": -10}`; `master_audio_tool {"preset": "social", "genre": "talking_head",
    "iterate": true}`; `render_video`; `review_render_tool`; one fix pass.

## Finish checklist
- [ ] No shot longer than 10 s; a visual change every 2-8 s.
- [ ] Every speaker turn within 5 frames of a cut (multi-cam).
- [ ] Exactly one highlighted word at a time.
- [ ] A text element says what this is about before 1 s.
- [ ] Captions never over the mouth; name card and captions never overlap.
- [ ] Bed continuous 15-25 dB under, or none; no exposed room tone.
- [ ] -14 LUFS, ≤ -1 dBTP; first 3 s contain the claim, not a greeting.
- [ ] The excerpt resolves (answer or lesson in the last 5 s).

## Mix-and-match
Borrow: `sentence-split-rapid-hook` for an edited hook, `ui-card-over-the-speaker`
for a stat or screenshot, `slide-in-pill-badge-and-name-cards`.
Never: `vo-keyed-emphasis-stack` with karaoke (two caption systems),
`accelerating-cut-length-ramp` (montage grammar in a conversation),
chapter cards.

## Reference moments
Local only, `~/zenvi-motion/refs2/podcast-clip-vertical/`: `x9qcfju@2.2` punch-in
ladder; `x9qcfju@26.6` speaker-turn cut; `x9qcfju@35.1` reaction cutaway;
`x9qcfju@0` karaoke captions; `x9sovts@0.5` headline context card;
`x9sovts@3.7` object insert; `x9sovts@40.1` end card; owner reel
`DWuJBWbFylY@0` sentence-split hook, `@2.3` speaker badge.

## Example (verified)
2026-10-29, 20.4 s, 720x1280, CLI only: one stock podcast take (single camera),
synthetic VO ("we almost shut down in year two…" to the answer), a punch-in
ladder at 1.5x on phrase ends, one coffee insert, karaoke captions, a quiet
headline from 0.3 s, the name card moved to the upper third, a 1.4 s black end
card, lofi bed ducked. Pairwise watch judge against the best watched reference
window (`x9sovts@0-30`): v1 tie 5.82 vs 5.59 (the excerpt stopped at the
cliffhanger, the name card collided with the captions); v2 6.14 vs 5.45 after
adding the answer and moving the card; v3 tie 5.82 vs 4.77. Remaining notes:
the synthetic voice, a too-literal insert, hold 0.8 s on the speaker before the
end card.
