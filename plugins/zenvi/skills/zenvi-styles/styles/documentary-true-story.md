---
id: documentary-true-story
kind: style
summary: "For a real person's story: cold open on the work and its sound, premise in their voice, title after the hook."
categories: [documentary-true-story]
tools: [add_clip_to_timeline_tool, separate_clip_audio_tool, trim_clips_tool, set_clip_audio_video_tool, add_sfx_tool, search_sound_library_tool, add_captions_tool, transcribe_media_tool, add_kinetic_title_tool, add_title_tool, fade_clip_tool, add_transition_tool, unify_grade_tool, set_track_role_tool, automate_volume_tool, master_audio_tool, review_render_tool]
pace: calm
mood: [honest, intimate, contemplative]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [t091, t042, t082, t124, t123, t115, t012, t119, t125]
avoid_with: [t086, t122, t056, t060, t074]
needs: []
---

# Documentary / true story

Two registers share this style. Observational long-form: open on the subject doing the thing with its own
sound and no music for 7-13 s, state the premise in the subject's or narrator's voice over cutaways, hold the
title until after the cold open, then establish the world on ambience and return to the subject. Graphic
short-form micro-documentary: a bold captioned claim, archive collage, one black card with a sub drop at the
turn, a short end card. Pick one per piece; mixing their cut rates is the average failure.

## When to use / not

- Use for: a person, a craft, a place, a company history told as a story; interviews with B-roll.
- Not for: arguments about ideas (video-essay), data (map-data), hype. Not for anything where the user cannot
  confirm the facts: never invent names, dates or quotes for a real subject.

## Structure

| length | cold open (work + foley) | premise in voice | title | world / context | return / close |
| --- | --- | --- | --- | --- | --- |
| 15 s | 0-4 s | 4-10 s | 10-12 s | - | 12-15 s |
| 30 s | 0-7 s | 7-16 s | 16-20 s | 20-27 s | 27-30 s |
| 60 s | 0-13 s | 13-40 s | 40-46 s (about 60-70%) | 46-55 s | 55-60 s |
| 90 s | 0-13 s | 13-45 s | 45-51 s | 51-75 s | 75-90 s |

Short-form micro-doc instead: hook claim 0-3 s, collage and captioned story, black turn card at 32-81%, end card
0.6-4 s.

## Shot plan

Rotation of wide (3-7 s), medium follow, 1.5-3 s detail (t042); static for places, handheld for labour; about
14 cuts per minute (micro-doc 33-55). Interview lines run under 3-6 s of the work they describe (L-cuts, t082).

## Look & grade

Natural saturation with shadow detail kept; one accent colour the subject already carries (a yellow coat, red
ice); slight warmth or a gentle dark cinema look (`unify_grade_tool` `elegant_dark_cinema` at 0.5). Grain on
archive only. Micro-doc: neutral base + one accent, paper border optional.

## Type system

Two faces at most: a quiet sans for subtitles (2.8-4%, bottom centre, t124) and a light serif or condensed caps
for the title (t123) and place names (t115, up to 25% height). Empty screen between title cards. Micro-doc
captions with 2-4x emphasis words.

## Motion & transitions

92% hard cuts on action or speech; dissolves only at structural joints (about 1.2 per minute): into the title,
into the context section. Fades to black between chapters. No whips, no flashes, no zoom-throughs.

## Sound & music

- Diegetic first: the work's own sound, room tone, place ambience (ambience -30 to -38 LUFS, 18+ dB under voice).
- Music enters at the first cutaway or on the title card, underscore only, 15-20 dB under the voice in
  long-form (8-10 in short-form), and dies with the picture at resets.
- Levels: long-form master -18 to -20 LUFS with LRA above 9 (do not squash); short-form social -14 LUFS.
- Cues: about 6 per minute, all diegetic; 0 whooshes or risers. Micro-doc only: sub drop on the turn card,
  thumps on a list, paper foley on collage.

## Captions/VO

Subject's own voice first (sync-sound interview), narrator only to bridge. Subtitles sentence-level (t124).
Narration calm, about 140-160 wpm, pauses kept. A translated subject gets subtitles for every line.

## Tool sequence

1. Cold open (t091): `add_clip_to_timeline_tool` close shots of the work with their sound; no sync sound:
   `add_sfx_tool` foley spotted to each visible action (`hit_transient`, `cloth`, `paper`, `seed` varied, -12 dB)
   + `room_tone` (-24 dB, `align: "start"`, `duration` = cold open).
2. Voice: interview clip (or `generate_tts_and_add_to_timeline_tool` / the user's VO) entering 4-7 s in;
   `set_track_role_tool` voice.
3. L-cut to cutaways (t082): `separate_clip_audio_tool`, `trim_clips_tool` the picture, cutaways on track 1
   after it with `set_clip_audio_video_tool` `{"audio": "off"}`.
4. Subtitles: `transcribe_media_tool` + `add_captions_tool` (or `cues`) `{"style": "classic", "text_size": 0.038,
   "background_opacity": 0}`.
5. Title after the cold open (t123): `add_kinetic_title_tool` `{"text": "The Last Repairman", "style":
   "documentary", "animation": "fade", "emphasis": "none", "background": "#000000", "text_size": 0.05,
   "duration_seconds": 3.6}`; music starts on this frame.
6. Context wides (t115): 2.5 s static wides on ambience, `fade_clip_tool` in/out, the place name
   `add_kinetic_title_tool` `{"style": "editorial", "animation": "fade", "text_size": 0.22, "ink": "#f2efe8"}`.
7. Grade once: `unify_grade_tool` `{"look": "elegant_dark_cinema", "look_intensity": 0.5}`.
8. Music bed from the title: `add_clip_to_timeline_tool`, `set_track_role_tool` music, -20 dB,
   `automate_volume_tool` `fade_out` 1.8 s at the end.
9. `master_audio_tool` (`preset: "social"` for shorts; `target_lufs: -19` for long-form), render, `review_render_tool`.

## Finish checklist

1. Opens on the sync sound of action, no music for 7-13 s (shorts: at least 4 s).
2. Title after the cold open, not at 0.
3. Zero whooshes or risers; about 6 cues per minute, all diegetic (`spot_sound_tool`).
4. Long-form around -18 to -20 LUFS with LRA above 9; shorts -14.
5. About 92% hard cuts; dissolves only at structural joints.
6. One accent colour the subject already carries; natural saturation.
7. Micro-doc only: emphasis words 2-4x body size, one accent.
8. Two faces at most; empty screen between title cards.
9. Shot variety: wide, medium, then a 1.5-3 s detail; no runs of mediums.
10. One cut rate per piece: about 14/min observational or 33-55/min graphic essay, not both.

## Mix-and-match

- Borrow: t091, t042, t082, t124, t123, t115 for observational; t012, t119, t125 for the micro-doc register.
- Never: cue-per-graphic sound design (t086), kids pop cards (t122, t056), news hook cards (t060) or drop montage
  (t074) in an observational piece.

## Reference moments

Local only (`~/zenvi-motion/refs2/documentary-true-story/`): `66507747@0` foley-first cold open, `66507747@17.7`
sound-bridge L-cut and shot rotation, `66507747@44.8` held title card on black into rack focus, `242923870@44.5`
write-on title with the runner, `242923870@56` fade-to-black reset with a giant place title. Owner reels in the
dossier: `De4rzMGsnw6@26.3` thesis turn card, `De4rzMGsnw6@60.5` four-word punch list, `DbqvQrPTPIS@4.3` 2.5D
collage.

## Verified

VERIFIED-PENDING
