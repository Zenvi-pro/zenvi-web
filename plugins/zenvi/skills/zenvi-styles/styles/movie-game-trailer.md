---
id: movie-game-trailer
kind: style
summary: "For a film, game or story teaser: slow world build, black-and-silence beats, a held hit, fast climax, small title."
categories: [movie-game-trailer]
tools: [set_project_setting_tool, gather_stock_footage_tool, search_freesound_music_tool, import_stock_media_tool, detect_beats_tool, add_clip_to_timeline_tool, set_clip_properties_tool, set_keyframes_tool, unify_grade_tool, color_grade_clip_tool, add_vignette_tool, fade_clip_tool, apply_motion_transition_tool, apply_transition_tool, add_kinetic_title_tool, search_sfx_tool, add_sfx_tool, automate_volume_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: medium
mood: [epic, tense, dark, mysterious]
aspect: ["2.39:1", "16:9", "9:16"]
pairs_with: [fire-superimposition-ramp, white-flash-or-light-leak-join, blackout-and-dead-silence-pause, accelerating-cut-length-ramp, single-accent-palette-grade, restrained-title-card-on-black, music-stops-dead-then-hit-or-line, close-mic-transient-on-detail-insert]
avoid_with: [karaoke-word-highlight-captions, giant-word-kinetic-statement, whip-transition-motion-blur-smear, staccato-sub-second-shot-burst]
needs: []
---

# Movie & game trailer

A trailer sells a world and a feeling, not a plot. It opens slow and quiet,
builds the world in hard cuts, stops dead on black and silence, lands one
held image with a hit, then climbs into a fast climax and ends on a small
title over black. Sound design punctuates; it is not a whoosh on every cut.

## When to use / not

Use for: film, short-film, game, series or book teasers; "cinematic trailer",
"epic", "teaser", "coming soon", a dramatic brand film told like a story.
Not for: a product ad with features (`product-launch-film`), a sports or
gaming kill montage cut on every beat (`sports-hype-edit`, `gaming-montage`),
a fast flash-cut edit (`flash-cut-match-cut-edit`), a lyric or music video.

## Structure (beats with timings)

The arc: texture cold open → small billing card → world build → black and
silence → the held hit → escalation (shots under 1 s) → black → title.
Two of the four watched trailers accelerate 1.4-2.9x from first to last
third; none holds one cut rate.

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Cold open: 1-3 slow shots, fade from black, rumble | 0-3 | 0-6.5 | 0-12 | 0-17 |
| Macro insert with dry foley (match, lock, pin) | 3-4 | 6.5-9 | 12-15 | 17-21 |
| Billing / tagline card, small, on black | 4-5.5 | 9-11.5 | 15-18 | 21-25 |
| World build, 1.5-2.5 s shots | 5.5-8.5 | 11.5-17 | 18-36 | 25-55 |
| Held hit: one 4-6 s shot, overlay or push builds (T029) | 8.5-11 | 17-21.5 | 36-42 | 55-62 |
| Black + dead silence | 0.5 | 0.8 | 0.6-1.9 | 0.6-1.9 |
| Escalation: 0.4-0.8 s shots, one white flash (T109) | 11.5-13.5 | 22-26.5 | 43-55 | 63-82 |
| Black, then title card with sub drop | 13.5-15 | 27-30 | 55-60 | 83-90 |

At 60-90 s add one dialogue or VO line inside the build with the music
carved out, and a second black beat before the escalation.

## Shot plan

- Mix: about a third close / extreme close (eyes, hands, objects), a quarter
  medium, a quarter wide / aerial, the rest inserts and black cards.
- Shot length: median 1.8-2.2 s overall; montage sections under 2 s; at least
  a 2x ratio between the slowest and fastest third.
- One world: same light, same palette, same kind of location throughout.
  Mixed stock reads as stock; pick clips that could be from one shoot
  (silhouettes and close-ups hide that best).
- Push-ins are the main move. Add a 3-8 % `set_keyframes_tool` scale push to
  any held static. No whip pans, no zoom punches.

## Look & grade

- Scope frame (1920x816 or 1920x804) unless the brief is vertical. Fill it:
  `set_clip_properties_tool {"scope":"all","properties":{"scale":"Crop"}}`.
- Palette per act: act 1 warm (desert, amber), act 2 cold and desaturated
  (saturation 0.5-0.6), act 3 fire or one saturated accent. One accent colour
  per sequence, the rest held down (`single-accent-palette-grade`).
- `unify_grade_tool` with a cinema look at 0.3-0.4 first, then
  `color_grade_clip_tool` per act; crush the dark insert after the flash
  (exposure -0.6, shadows -0.6). Vignette 0.2 / feather 0.85 at most.
- Blow out highlights on purpose once (the flash). Grain is optional.

## Type system

- Almost none: no captions, no lower thirds, no animated or big type.
- Billing / tagline card: centred all caps, 4-6 % of frame height
  (`text_size` 0.045 on 2.39:1), 2-3.6 s, fade only, on black.
- Title: the same face at 6-8 %, on black, 2.5-3 s, at the very end.
- `add_kinetic_title_tool` style `documentary`, animation `fade`,
  `emphasis` `none` (the default bolds one word), `background` `#000000`.

## Motion & transitions

- Hard cuts on at least 85 % of joins.
- Black frames as punctuation: 2-4 per minute, 0.5-1.9 s.
- One white flash per film (3-6 frames, `apply_motion_transition_tool`
  `flash_white`, duration 0.15-0.25) into an underexposed insert, with a boom.
- Dissolves only in a memory / quiet passage, 1.0 s.

## Sound & music

- Music: orchestral / drone tension that builds (Freesound
  "suspenseful dramatic", "dark trailer"). Cut the bed with two clips of the
  same track: the build ends dead on the black beat, the climax starts from
  the loudest part of the track.
- Cuts on audio onsets and hits, not a beat grid (onset 50 %, beat 28 %).
- Cue density 0.25-0.5 per cut: dry foley on the macro insert, a riser ending
  on the smash, booms on the black and the flash, a synth sub drop on the
  title. Whoosh on fewer than 10 % of cuts.
- At least one designed silence (bed under -50 dBFS for 0.5-1.9 s) per 30 s.
- Levels (CRAFT.md): hero hits momentary -9…-11 LUFS, 0 to +3 LU over the
  bed; foley on the insert 2-3 dB over the bed. Keep dynamics: master to
  -16 LUFS / -1.5 dBTP with `balance` `keep` (trailers measure -20 to -24
  LUFS with LRA 17-18 LU; -14 squashes them).

## Captions/VO

No captions. At 60 s and up: 1-3 short lines, slow (≤ 80 wpm), close and low,
with the music dipped 8-12 dB under each (`automate_volume_tool` `dip`).

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 816, "fps": 24}
gather_stock_footage_tool {"queries": ["man silhouette walking desert sunset", "close up eyes dramatic", "hand lighting match dark", "storm clouds", "dark corridor flashlight", "fire explosion black background", "sparks flying slow motion", "smoke dark atmosphere"], "count": 20, "orientation": "landscape", "min_seconds": 4, "max_seconds": 30}
search_freesound_music_tool {"query": "suspenseful dramatic build", "min_seconds": 60}
import_stock_media_tool {"source": "freesound", "sound_id": "<id>", "preview_url": "<url>"}
```

Place every shot by hand (`add_clip_to_timeline_tool` with `start_seconds` /
`end_seconds` picked from each clip's contact sheet), times on whole frames
(multiples of 1/24 s) so motion transitions find a seamless cut:

```json
add_clip_to_timeline_tool {"file_id": "<aerial>", "position_seconds": 0, "start_seconds": 2, "end_seconds": 5.6, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<explosion on black>", "position_seconds": 17.4, "start_seconds": 0.3, "end_seconds": 4.3, "track": "2"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
unify_grade_tool {"look": "teal_cinema", "look_intensity": 0.35}
color_grade_clip_tool {"timeline_clip_ids": ["<act 2 clips>"], "saturation": 0.55, "contrast": 0.2, "shadows": -0.3}
add_vignette_tool {"amount": 0.2, "feather": 0.85}
fade_clip_tool {"clip_id": "<first shot>", "fade_in_seconds": 1.2}
set_clip_properties_tool {"timeline_clip_ids": ["<explosion>"], "properties": {"composite": "screen"}}
set_keyframes_tool {"timeline_clip_id": "<explosion>", "property": "alpha", "points": [{"timeline_seconds": 17.4, "value": 0}, {"timeline_seconds": 21.3, "value": 1}], "ease": "ease_in_quad"}
apply_motion_transition_tool {"preset": "flash_white", "clip1_id": "<last climax shot>", "clip2_id": "<dark insert>", "duration": 0.2}
add_kinetic_title_tool {"text": "<TAGLINE>", "position_seconds": 9, "duration_seconds": 2.6, "style": "documentary", "animation": "fade", "emphasis": "none", "text_size": 0.045, "background": "#000000", "stagger_seconds": 0}
add_kinetic_title_tool {"text": "<TITLE>", "position_seconds": 27.2, "duration_seconds": 2.8, "style": "documentary", "animation": "fade", "emphasis": "none", "text_size": 0.07, "background": "#000000", "stagger_seconds": 0}
add_clip_to_timeline_tool {"file_id": "<music>", "position_seconds": 0, "start_seconds": 30, "end_seconds": 51.4, "track": "5"}
add_clip_to_timeline_tool {"file_id": "<music>", "position_seconds": 22.2, "start_seconds": 91, "end_seconds": 95.4, "track": "5"}
search_sfx_tool {"query": "match strike", "count": 5}
add_sfx_tool {"provider": "freesound", "sound_id": "<id>", "title": "<title>", "at_seconds": 7.55, "gain_db": -4}
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 21.4, "duration": 3.0, "gain_db": -14}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": 21.4, "gain_db": -4}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": 25.625, "pitch": -3, "gain_db": -5}
add_sfx_tool {"recipe": "sub_drop", "kit": "synth", "at_seconds": 27.2, "gain_db": -4}
add_sfx_tool {"recipe": "tail_bloom", "at_seconds": 27.2, "gain_db": -12}
master_audio_tool {"target_lufs": -16, "true_peak_dbtp": -1.5, "balance": "keep"}
review_edit_tool {}
```

Render, then `review_render_tool` on the file; one fix pass.

## Finish checklist

- [ ] At least one black + dead-silence beat per 30-60 s; the bed is not continuous.
- [ ] Montage sections cut under 2 s median; slowest third ≥ 2x the fastest.
- [ ] Sound cues on 25-50 % of cuts, typed (foley, hits, risers); whoosh < 10 %.
- [ ] Dynamics kept: loud climax, quiet open, -16 LUFS or quieter, true peak ≤ -1.5 dBTP.
- [ ] Any line sits in a carved-out bed and is ≤ 80 wpm.
- [ ] Type small (4-8 % height), centred, fade only; no captions.
- [ ] ≥ 85 % hard cuts; one white flash; dissolves only in a quiet passage.
- [ ] Each act has its own grade and one accent colour.
- [ ] Ends on a hit, then black and the title; it never fades out on the bed.
- [ ] Frame filled (no pillarbox in 2.39:1) and footage sound muted unless chosen.

## Mix-and-match

Borrow: fire-superimposition-ramp (the held hit), white-flash-or-light-leak-join
(one per film), blackout-and-dead-silence-pause, music-stops-dead-then-hit-or-line,
accelerating-cut-length-ramp, close-mic-transient-on-detail-insert,
restrained-title-card-on-black, single-accent-palette-grade, and the cinematic
family's push-ins and letterbox looks. Never: karaoke or kinetic captions,
giant kinetic words, whip chains, glitch transitions, a whoosh carpet, a
social -14 LUFS limiter squash, emoji or stickers.

## Reference moments

Local only, in `~/zenvi-motion/refs2/movie-game-trailer/`:
`oppenheimer-official-trailer-2` (billing card 11.2 s, silence on black
40.2 s, fire superimposition 35.0-39.5 s, white flash into a dark insert
45.8 s, accelerating thirds 4.3 / 2.15 / 1.5 s); `dune-part-two-imax-trailer-1`
(vision montage 0-16.8 s at 1.1 s shots, black beats 27.2 and 54.0 s,
diegetic thumper as the beat 21.0 s); `437808118` (game trailer: macro pin
insert with foley 19.9 s, riser to boom on the cut 46.8-51.9 s);
`sintel-movie-trailer` (1.0 s memory dissolves 10.3 s, smash to black with a
sub drop 121.2 s).

## Example (verified 2026-10-28)

See the end of this file once the judged example is in; build script:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/styles/movie-game-trailer.build.sh`.
