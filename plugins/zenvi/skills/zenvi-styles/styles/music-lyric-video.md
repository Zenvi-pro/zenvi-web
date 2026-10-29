---
id: music-lyric-video
kind: style
summary: "For a song or spoken-word piece: lyrics on the vocal onsets, resets in the breaths, one treatment, the song as the mix."
categories: [music-lyric-video]
tools: [set_project_setting_tool, gather_stock_footage_tool, import_files_tool, transcribe_media_tool, get_transcript_tool, analyze_timeline_audio_tool, add_marker_tool, add_clip_to_timeline_tool, set_clip_properties_tool, unify_grade_tool, fade_clip_tool, set_keyframes_tool, kinetic_captions_tool, add_kinetic_title_tool, add_captions_tool, edit_captions_tool, subject_glow_tool, generate_subject_matte_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: calm
mood: [emotional, intimate, moody, dreamy]
aspect: ["9:16", "16:9", "1:1", "4:5"]
pairs_with: [lyric-text-timed-to-vocals, reset-inside-the-vocal-rest, diegetic-lyric-on-set-props, one-hue-treatment-with-glow-silhouette, faceless-performer-occlusion, bar-phrase-and-lyric-locked-cutting]
avoid_with: [commentary-hits-with-dense-designed-cues, white-flash-or-light-leak-join, giant-word-kinetic-statement, karaoke-word-highlight-captions, whip-and-match-cut-chain]
needs: [lyric-forced-alignment, music-structure-detect]
---

# Music & lyric video

The words are the picture: each line (or word, or syllable) appears on its
vocal onset, the block holds, and it clears inside a breath, never on a
metronome. Behind it, one visual treatment (a single hue, black and white,
or type on black) and one idea that changes over the runtime. The song is
the whole mix.

## When to use / not

Use for: lyric videos, visualizers, spoken-word and poetry pieces, a song
snippet for socials, a quote read over music. Not for: a performance music
video with a band (cut it like `sports-hype-edit` or `fashion-beauty-ad`), a
talking head with captions (`talking-head-captions`), kinetic-type ads
(`kinetic-type-motion-design`).

## Structure (beats with timings)

Song form drives it. First text within 1 s; no intro card or logo.

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| First line on screen | 0.5 | 0.6 | 0.6 | 0.9 |
| Stanza 1: 3-9 words build line by line, hold | 0.5-6 | 0.6-7 | 0.6-12 | 0.9-15 |
| Breath reset: hard cut or text clear in the rest | 6-7 | 7-8 | 12-13 | 15-16 |
| Stanza 2 (new shot or layout) | 7-11 | 8-15 | 13-24 | 16-30 |
| Fade to black held ~1.7 s through a long rest | – | 15-17 | 24-26 | 30-32 |
| Chorus / drop: hard cut, brighter bigger shot | 11-13 | 17-22 | 26-40 | 32-60 |
| Visual turn (new element enters) | – | – | 40 (≈ 69 %) | 62 |
| Last phrase fully assembled and held 4 s, fade | 13-15 | 22-28 | 52-60 | 82-90 |

Stanza blocks run 3-7 s (median ~4 s).

## Shot plan

- Few shots: one per stanza, 4-8 s, cut on the drop or in a breath. In a
  dance or concept piece, cut faster in verse 1 and chorus 1 (26-29 per
  minute), then hold 4+ s wides at the climax.
- Footage is texture behind type: night sea, rain on glass, silhouettes,
  smoke, stars, a slow figure. Keep the lyric's zone calm (sky, black water).
- One element other than the text changes over the runtime (a figure
  enters, the light shifts, the camera drifts): type on black alone scores
  lowest.
- Push 5-8 % (`set_keyframes_tool` scale) on long holds.

## Look & grade

- One treatment for the whole piece: a single hue (cobalt night
  `unify_grade_tool` look `duotone #02060f #9cc3ff` at ~0.85), zero
  saturation, or pure black and off-white.
- The focal element is the brightest thing in frame: type or a glowing
  silhouette (`generate_subject_matte_tool` + `subject_glow_tool`).
- Crushed shadows, no grain on clean night footage.

## Type system

- One face, one size (3.8-6 % of frame height); emphasis comes from timing
  and layout, not size. The one exception: a shout line in caps at 1.2x.
- Three proven layouts: centred serif phrases (`kinetic_captions_tool` style
  `editorial`, animation `fade`, ~4-frame fades); a centred monospace /
  condensed stack with syllables snapping on, no fade (style `stack`); a
  lowercase subtitle line at the bottom (`add_captions_tool` from an SRT).
- `emphasis` `none` unless one word must glow; the accent colour belongs to
  the treatment.
- Lyrics avoid the subject (bottom, above the horizon, or left of centre on
  black); pass `avoid` boxes for a face.

## Motion & transitions

- Text in on the vocal onset (within 2 frames), out together at the stanza
  end, inside the rest.
- Picture: hard cuts in breaths or on the drop; one fade to black through a
  long rest. No flashes, whips or glitch.

## Sound & music

- The song is the mix: 0-2 added cues per 90 s (a stinger on a shout line at
  most). Never `auto_sound_design_tool` at its default density.
- Master `social` -14 LUFS, true peak ≤ -1 dBTP. With a separate vocal and
  bed (spoken word), let `master_audio_tool` duck the bed under the voice
  (`speech_clip_ids`, `music_clip_ids`): voice -15 LUFS, bed 8-12 LU under.

## Captions/VO

The lyric is the caption. Timing source, in order of preference: a known
lyric sheet with hand-set cues (`kinetic_captions_tool` `cues`, one cue per
sung line, end = stanza clear time); `transcribe_media_tool` on a spoken or
clearly sung vocal; never trust ASR on a dense sung mix (`lyric-forced-alignment`
is missing: no tool aligns known lyrics to sung audio).

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 1080, "fps": 24}
gather_stock_footage_tool {"queries": ["ocean waves at night", "dancer silhouette", "rain window night", "night sky stars", "candle flame dark"], "count": 10, "orientation": "landscape", "min_seconds": 6}
import_files_tool {"paths": ["<song or vocal>.wav", "<bed>.mp3"]}
add_clip_to_timeline_tool {"file_id": "<vocal>", "position_seconds": 0, "start_seconds": 0, "end_seconds": 28, "track": "4"}
analyze_timeline_audio_tool {}
add_marker_tool {"position_seconds": 7.7, "name": "rest"}
add_clip_to_timeline_tool {"file_id": "<night sea>", "position_seconds": 0, "start_seconds": 3, "end_seconds": 10.75, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<silhouette>", "position_seconds": 7.75, "start_seconds": 0, "end_seconds": 7.25, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<waves>", "position_seconds": 17, "start_seconds": 2, "end_seconds": 13, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
unify_grade_tool {"look": "duotone #02060f #9cc3ff", "look_intensity": 0.85}
fade_clip_tool {"clip_id": "<silhouette>", "fade_out_seconds": 0.4}
fade_clip_tool {"clip_id": "<waves>", "fade_in_seconds": 0.3, "fade_out_seconds": 1.5}
kinetic_captions_tool {"style": "editorial", "animation": "fade", "emphasis": "none", "text_size": 0.05, "cues": [{"start": 0.6, "end": 6.9, "text": "<line 1>"}, {"start": 2.4, "end": 6.9, "text": "<line 2>"}, {"start": 4.3, "end": 6.9, "text": "<line 3>"}]}
master_audio_tool {"preset": "social", "speech_clip_ids": "<vocal>", "music_clip_ids": "<bed>"}
review_edit_tool {}
```

Render and `review_render_tool`; check every text onset against the vocal
in the render (frame-step the contact sheet at each line start).

## Finish checklist

- [ ] Text onsets within 2 frames of the vocal onsets.
- [ ] Every stanza clear and every cut lands in a vocal rest or on the drop.
- [ ] One treatment everywhere; the focal element is the brightest.
- [ ] Something other than text changes over the runtime.
- [ ] One face, one size (≤ 1.2x for a shout line).
- [ ] Lyrics never overlap the subject.
- [ ] A plain silent / black gap is allowed where the vocal rests.
- [ ] Added cues < 10 % of cuts; the song is the mix.
- [ ] First text within 1 s; last phrase held ~4 s.
- [ ] Master -14 LUFS, true peak ≤ -1 dBTP.

## Mix-and-match

Borrow: lyric-text-timed-to-vocals, reset-inside-the-vocal-rest,
diegetic-lyric-on-set-props (a shoot-time idea), one-hue-treatment-with-glow-silhouette,
faceless-performer-occlusion (concept videos; needs tracking),
bar-phrase-and-lyric-locked-cutting, the kinetic family's letter reveals for a
single hook line. Never: whoosh or hit per cut, white flashes, karaoke pills,
giant slam words, several faces and sizes.

## Reference moments

Local only, in `~/zenvi-motion/refs2/music-lyric-video/`: `DV5Jqt2iQC4`
(syllable-snap monospace stanza 0.9-5.1 s, cut in the breath 8.3 s, white
glowing silhouette on a cobalt night sea 0 s); `Ddz5ivuTLAc` (serif italic
stanza on black, 4-frame word fades 0.5-3.2 s, 1.7 s black through a rest
10.3-12.0 s); `sia-cheap-thrills` (CRT frame for the whole piece, bottom
subtitle with a caps shout line 27.0 s, lyric on spinning records 20.2 s,
chorus drop cut 22.8 s, faceless dancers 62.4 s).

## Example (verified 2026-10-28)

See the end of this file once the judged example is in; build script:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/styles/music-lyric-video.build.sh`.
