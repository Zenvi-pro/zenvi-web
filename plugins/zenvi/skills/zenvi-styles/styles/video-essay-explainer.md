---
id: video-essay-explainer
kind: style
summary: "For an argued explainer or micro-documentary over B-roll: claim, proof run cut on the words, one slam card at the turn."
categories: [video-essay-explainer]
tools: [gather_stock_footage_tool, generate_tts_and_add_to_timeline_tool, get_transcript_tool, add_clip_to_timeline_tool, set_clip_audio_video_tool, color_grade_clip_tool, apply_look_preset_tool, kinetic_captions_tool, add_kinetic_title_tool, add_sfx_tool, search_freesound_music_tool, set_track_role_tool, set_audio_gain_tool, automate_volume_tool, master_audio_tool, review_render_tool]
pace: fast
mood: [smart, persuasive, cinematic]
aspect: ["9:16", "16:9"]
pairs_with: [t119, t125, t082, t012, t123, t011, t086]
avoid_with: [t122, t056, t090, t101]
needs: []
---

# Video essay / explainer

A narrator argues one idea and the picture proves it: every claim is followed within a second by the footage
that shows it, fast proof runs alternate with held examples, one designed reset (a black card with one or two
huge words) marks the turn, and the payoff is the longest shot. Short-form (the owner's reels) is the target:
captions, keyword slams, sound on every graphic event, -14 LUFS. Long-form essays keep the same grammar with
almost no type and much quieter sound.

## When to use / not

- Use for: "why X happened", history of an object or company, a thesis about culture or tech, film analysis,
  brand manifestos told as an argument.
- Not for: a person talking to camera (talking-head styles), observational stories (documentary-true-story),
  data that must be read (map-data-explainer), pure animation (animated-explainer).

## Structure

| length | hook | setup / claim | proof run | turn (slam card) | payoff hold | tag |
| --- | --- | --- | --- | --- | --- | --- |
| 15 s | 0-2 s | 2-4 s | 4-8 s | 8-9.5 s | 9.5-13 s | 13-15 s |
| 30 s | 0-2.5 s | 2.5-6 s | 6-15 s | 15-17 s (50-60%) | 17-26 s | 26-30 s |
| 60 s | 0-4 s | 4-10 s | 10-30 s (two runs) | 30-33 s | 33-54 s | 54-60 s |
| 90 s | 0-5 s | 5-14 s | 14-45 s (three runs) | 45-48 s | 48-82 s | 82-90 s |

The hook is a claim or provocation over the strongest image, spoken from frame 1. The turn sits at 33-68% of
the runtime; the tag is a philosophical line, a held portrait fading out, or a brand lockup (1-4 s).

## Shot plan

- Median shot about 1.3 s in short-form (0.7 s in lists), with holds of 3-6 s on the key line: p90/median 2-3.6.
- Every noun in a claim gets its literal picture within 1 s (t011); 30-50% of shots may be graphics, titles or
  renders in reels.
- Archive, objects and places beat generic stock; one shot per idea, never two similar shots in a row.

## Look & grade

One controlled system: a neutral base (black, cream paper or desaturated archive) plus ONE accent hue (red in
3 of 5 reference reels). Desaturate mixed sources to sit together (`saturation` 0.6-0.75), deep blacks, grain on
everything (`film_grain_16mm_classic`). Optional constant paper border or frame across every asset.

## Type system

- Captions: one sans, a phrase at a time, centre or lower-centre, 3.5-7% of frame height (`kinetic_captions_tool`
  `style: "documentary"`; `"creator"` for a punchier reel).
- Emphasis: keyword slams at 3-4.5x the caption size (12-18% height), at most one per 10 s.
- One serif accent at most twice (the payoff word, `add_kinetic_title_tool` `style: "editorial"`).
- Long-form: no captions; type only for attribution ("Film (year)", t123).

## Motion & transitions

Hard cuts (about 70%) on the word, not the bar; designed transitions about 5 per minute and only at graphic
changes or the turn: slam card, a match cut, a push or zoom-through, one paper wipe. Camera moves are the
editor's: slow push-ins and parallax on stills (t012), snap punch-ins.

## Sound & music

- Music: electronic underscore (ambient pad, lo-fi, tense pulse) for reels; jazz or an even groove for long-form.
  Tense or sparse opening, drive in the middle, a dip or drop before the turn, peak late.
- Levels (sound/CRAFT.md, video essay): voice -15 LUFS dialog-gated, music 8-10 dB under the voice (reels
  measure about 4-8 dB; keep at least 8 for intelligibility), master -14 LUFS / -1 dBTP. Long-form: -18 to -20
  LUFS with the bed 15+ dB under.
- Cues: sub drop + impact on the slam, a thump per list word, paper or film-flutter foley on collage moves,
  clicks on pop-ins; 10-25 per minute in reels, at most one designed hit per 20 s in long-form.

## Captions/VO

VO 145-185 wpm, almost wall-to-wall (speech fraction 0.8-0.99) in reels; about 140 wpm with pauses in long-form.
Generate it with `generate_tts_and_add_to_timeline_tool` (`voice: "onyx"`, one call per line so each line's
start is known) or use the user's recording; cut picture on the line starts.

## Tool sequence

1. VO: one `generate_tts_and_add_to_timeline_tool` per line (`position_seconds` back to back) or the recording,
   then `get_transcript_tool` `{"includeWords": true}`; `set_track_role_tool` `{"track": "<vo>", "role": "voice"}`.
2. Footage: `gather_stock_footage_tool` `{"queries": [one per claim noun], "count": 12}`.
3. Proof run: `add_clip_to_timeline_tool` per shot with `position_seconds` = the line or word start and
   `start_seconds`/`end_seconds` cut to the next word; mute all with `set_clip_audio_video_tool` `{"audio": "off"}`.
4. Grade once: `color_grade_clip_tool` `{"timeline_clip_ids": [...], "saturation": 0.6, "contrast": 0.2,
   "shadows": -0.1}` then `apply_look_preset_tool` `film_grain_16mm_classic`.
5. Captions: `kinetic_captions_tool` `{"cues": [...], "style": "documentary"}` (leave out the list words and the
   slam words, they get their own titles).
6. List punch (t125): per word `add_kinetic_title_tool` `{"style": "stack", "animation": "slam",
   "text_size": 0.14, ...}` + `add_sfx_tool` `impact_thud` (seed per word).
7. Turn (t119): `add_kinetic_title_tool` `{"text": "DO NOT OPEN", "style": "stack", "animation": "slam",
   "background": "#0b0b0b", "accent": "#e1261c", "emphasis": ["OPEN"], "text_size": 0.2}` + `add_sfx_tool`
   `sub_drop` and `impact_slam` (-10 dB) + `automate_volume_tool` `{"role": "music", "shape": "dip", "db": -14}`.
8. Payoff word in the serif accent: `add_kinetic_title_tool` `{"style": "editorial", "animation": "rise",
   "emphasis": ["out"], "accent": "#e1261c", "text_size": 0.09}` over the longest hold.
9. Music: `search_freesound_music_tool` `{"query": "lofi chill hip hop", "bpm_range": "80-95"}`,
   `import_stock_media_tool`, `add_clip_to_timeline_tool`, `set_track_role_tool` music, `set_audio_gain_tool`
   -20, `automate_volume_tool` `fade_out` at the end.
10. `master_audio_tool` `{"preset": "social", "genre": "video_essay", "iterate": true}`, render, `review_render_tool`.

## Finish checklist

1. At least half of picture changes start within a frame of a spoken word onset.
2. No VO claim runs more than 3 s over unrelated footage.
3. A fast run near 1 s median and at least one hold of 3x the median on the key line.
4. At least one emphasis word at 9%+ of frame height vs a 4-5% base; at most one per 10 s.
5. Exactly one slam card, between 33% and 68% of the runtime, with the bed dipped.
6. Every title and graphic entrance has a cue (short-form); long-form at most one hit per 20 s.
7. Short-form -14 LUFS, true peak at or below -1 dBTP; long-form bed 15+ dB under the VO.
8. One accent hue across all graphics, one grade over all footage.
9. No caption on a clip that carries its own dialogue (long-form).
10. A second typeface at most twice.

## Mix-and-match

- Borrow: t119 (the turn), t125 (lists), t082 (archive speaker as L-cut), t012 (stills as collage), t123
  (long-form attribution), t011 (literal inserts), t086 (cue per graphic, short-form only).
- Never combine with kids pop cards (t122, t056), fixed-length loops (t090) or morph chains (t101): they break
  the argued, evidential register.

## Reference moments

Local only (`~/zenvi-motion/refs2/video-essay-explainer/`): `96558506@11.4` keyword-synced proof run (13 shots in
14.8 s), `96558506@71.8` payoff hold, `166319350@10.9` black attribution card with music entering,
`166319350@28.9` L-cut pre-lap of a lecture, `101675469@0` offset split-screen boxes, `101675469@22.8` motion
match-cut chain. Owner reels in the dossier: `De4rzMGsnw6@26.3` and `Da2tCdfxI-r@36.2` slam card at the turn,
`De4rzMGsnw6@60.5` staccato list.

## Verified

VERIFIED-PENDING
