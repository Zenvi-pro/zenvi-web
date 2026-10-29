---
id: wedding-event-film
kind: style
summary: "For a wedding, party or event highlight: phrase-cut to one song, real sound at the moments, soft grade, a held payoff."
categories: [wedding-event-film]
tools: [set_project_setting_tool, gather_stock_footage_tool, search_freesound_music_tool, import_stock_media_tool, detect_beats_tool, add_clip_to_timeline_tool, set_clip_properties_tool, apply_transition_tool, apply_motion_transition_tool, unify_grade_tool, add_vignette_tool, set_keyframes_tool, add_kinetic_title_tool, search_sfx_tool, add_sfx_tool, automate_volume_tool, separate_clip_audio_tool, duck_tool, fade_clip_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: calm
mood: [romantic, warm, joyful, intimate]
aspect: ["16:9", "2.39:1", "9:16", "4:5"]
pairs_with: [diegetic-sound-carries-the-cut, white-flash-or-light-leak-join, dissolve-on-calm-hard-cut-on-action, tighten-then-release-into-held-payoff, soft-bloom-lifted-shadow-grade, l-cut-audio-carrying-over-a-cutaway, restrained-title-card-on-black]
avoid_with: [whip-and-match-cut-chain, staccato-sub-second-shot-burst, giant-word-kinetic-statement, glitch-transitions, commentary-hits-with-dense-designed-cues]
needs: [music-structure-detect]
---

# Wedding & event film

A chronological highlight of one day, cut to one song on its phrases, not
its beats. Details and portraits breathe at 3-5 s; real sound (an engine, a
laugh, applause) breaks through the music at the moments that matter; one
soft grade holds everything together; the film ends on a held payoff.

## When to use / not

Use for: weddings, engagements, birthdays, galas, conferences told as a
day, "highlight film", "same-day edit", "event recap". Not for: a hype recap
of a festival or sports event (`sports-hype-edit`), a corporate event with
speakers on stage (`brand-story-corporate` with interview cuts), a travel
diary (`travel-cinematic-montage`).

## Structure (beats with timings)

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Emotional opener: rings, preparation details, dissolves | 0-4 | 0-7.4 | 0-11 | 0-16 |
| Names title over a sunlit / foliage shot, 3.3 s | 4-7 | 7.4-12.4 | 11-15 | 12-16 |
| Set piece with real sound (car start, doors, first look) | 7-9 | 12.4-17.3 | 15-26 | 16-26 |
| Portraits and the couple | 9-11 | 17.3-19.8 | 26-46 | 26-58 |
| Guests: crowd sound enters on the cut | 11-12.5 | 19.8-22.3 | 46-52 | 58-80 |
| Tighten: 2-3 shots shrinking to ~1.2 s | 12.5-13 | 22.3-24.75 | 52-55 | 80-84 |
| Held payoff with applause, 5-6 s | 13-15 | 24.75-30 | 55-60 | 84-90 |

All boundaries sit on bar downbeats or phrase ends of the song.

## Shot plan

- Shot length median 3.5-4.5 s (p10 ~2.5 s, p90 ~6.5 s); anything over 8 s
  is a deliberate emotional hold.
- Alternate scale: never 3 consecutive shots of the same scale; detail →
  medium → wide.
- Inserts belong to the scene next to them (same room, same moment).
- Macro texture → full-body movement cut: a hand on silk to a twirl, the
  fabric's motion carrying across the hard cut.
- One couple. Stock of several couples reads as stock: favour anonymous
  details (rings, hands, dress, shoes, bouquet, car, venue) and keep faces to
  one couple's shots.

## Look & grade

- One grade family for the film: high-key soft romantic (lifted blacks,
  soft whites, warm skin, mild bloom and edge vignette) or natural earth.
- `unify_grade_tool` with `romantic_cinema` (or `dreamy_cinema`) at ~0.5;
  `add_vignette_tool` 0.15 / feather 0.9. Bloom is `apply_fx_tool` bloom
  (CLI / local only).
- No clip off the film's median luma by more than ~30. A black-and-white
  source clip breaks the grade: skip it or grade the whole film mono.

## Type system

- At most one title: the names, 3.3 s, fading, ~9 % of frame height, serif or
  script, centre or centre-left over a moving foliage / light shot
  (`add_kinetic_title_tool` style `editorial`, animation `rise`, `emphasis`
  `none`, `text_size` 0.09).
- No captions unless a vow or toast carries the story; then
  `documentary` style at the lower safe line.

## Motion & transitions

- Hard cuts on action; dissolves (0.5-1 s, `apply_transition_tool`) only
  between calm, similar details in the prep sequence.
- White flash / light leak at a scene boundary only, at most 1-2 per minute
  (`apply_motion_transition_tool` `flash_white`, duration 0.4, intensity
  0.8). Seven in 90 s is judged harsh; the best watched film has none.
- Slow push (3-5 %) on the held payoff.

## Sound & music

- One song (piano, acoustic, strings) at 70-100 bpm. Cut on bar downbeats and
  phrase ends, not on every beat (18-35 % of beats is normal):
  `detect_beats_tool` downbeats, and halve the bpm on a slow song. Phrase /
  lyric-pause detection is missing (`music-structure-detect`).
- Real sound at action, at least one per 25 s: an engine start, doors,
  clapping, laughter, applause. Use the footage's own sound
  (`separate_clip_audio_tool`) when it was recorded; otherwise a real CC0
  recording (`search_sfx_tool`) placed on the action frame.
- Diegetic sound carries the cut (`diegetic-sound-carries-the-cut`): the song
  dips 3-7 dB for 2-4 s (`automate_volume_tool` `dip`, fade 250 ms) while the
  real sound speaks, then returns. Crowd sound enters on the hard cut to the
  guests, a few dB under the music.
- Levels (CRAFT.md): bed -14…-16 LUFS; diegetic hero at or slightly above
  the dipped bed; ambience -30…-38 LUFS. Master -14…-16 LUFS, true peak ≤
  -1 dBTP (the louder watched film peaks over 0 dBTP: do not copy that).

## Captions/VO

Optional vow or speech audio as the narrative layer (J-cut under the
b-roll, music ducked with `duck_tool` under voice). Captions only for that,
sentence by sentence.

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 1080, "fps": 24}
gather_stock_footage_tool {"queries": ["wedding rings close up", "bride getting ready makeup", "wedding dress detail", "groom suit", "wedding couple kiss", "vintage car wedding", "wedding guests dancing", "wedding venue aerial", "bride bouquet", "sun through leaves"], "count": 20, "orientation": "landscape", "min_seconds": 4, "max_seconds": 30}
search_freesound_music_tool {"query": "romantic piano", "min_seconds": 40}
import_stock_media_tool {"source": "freesound", "sound_id": "<id>", "preview_url": "<url>"}
detect_beats_tool {"file_id": "<music>"}
```

Shots back to back on the downbeats (97.5 bpm: a bar every 2.46 s):

```json
add_clip_to_timeline_tool {"file_id": "<rings>", "position_seconds": 0, "start_seconds": 1, "end_seconds": 3.47, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
apply_transition_tool {"clip1_id": "<rings>", "clip2_id": "<makeup>", "duration": 0.6}
apply_motion_transition_tool {"preset": "flash_white", "clip1_id": "<car aerial>", "clip2_id": "<couple outdoors>", "duration": 0.4, "intensity": 0.8}
unify_grade_tool {"look": "romantic_cinema", "look_intensity": 0.5}
add_vignette_tool {"amount": 0.15, "feather": 0.9}
set_keyframes_tool {"timeline_clip_id": "<payoff>", "property": "scale_x", "points": [{"timeline_seconds": 24.75, "value": 1}, {"timeline_seconds": 30, "value": 1.05}]}
add_kinetic_title_tool {"text": "<Name & Name>", "position_seconds": 8.2, "duration_seconds": 3.3, "style": "editorial", "animation": "rise", "emphasis": "none", "text_size": 0.09, "stagger_seconds": 0.15}
add_clip_to_timeline_tool {"file_id": "<music>", "position_seconds": 0, "start_seconds": 0.72, "end_seconds": 30.72, "track": "5"}
search_sfx_tool {"query": "car engine start", "count": 6}
add_sfx_tool {"provider": "openverse", "sound_id": "<id>", "title": "<title>", "at_seconds": 12.6, "gain_db": -6}
automate_volume_tool {"clip_ids": "<music>", "shape": "dip", "start_seconds": 12.38, "end_seconds": 16.6, "db": -7, "fade_ms": 250}
add_sfx_tool {"provider": "openverse", "sound_id": "<crowd id>", "title": "<title>", "at_seconds": 19.8, "gain_db": -14}
add_sfx_tool {"provider": "openverse", "sound_id": "<applause id>", "title": "<title>", "at_seconds": 24.75, "gain_db": -12}
fade_clip_tool {"clip_id": "<music>", "fade_out_seconds": 1.5}
master_audio_tool {"target_lufs": -15, "true_peak_dbtp": -1.0, "balance": "keep"}
review_edit_tool {}
```

Render and `review_render_tool`; one fix pass.

## Finish checklist

- [ ] At least one real sound per 25 s, on an action, the music making room for it.
- [ ] ≤ 2 flash / leak joins per minute, each at a scene boundary.
- [ ] Shot median 3.5-4.5 s; nothing over 8 s unless it is the emotional hold.
- [ ] The payoff is the longest shot of its block, with applause or a held moment.
- [ ] No 3 consecutive shots of the same scale.
- [ ] Every insert belongs to the scene next to it.
- [ ] One title at most, small, fading; no captions without speech.
- [ ] One grade family; no clip off the median luma by > ~30.
- [ ] Cuts on bar or phrase boundaries, not every beat.
- [ ] Master -14…-16 LUFS, true peak ≤ -1 dBTP.

## Mix-and-match

Borrow: diegetic-sound-carries-the-cut, dissolve-on-calm-hard-cut-on-action,
tighten-then-release-into-held-payoff, white-flash-or-light-leak-join (one),
soft-bloom-lifted-shadow-grade, l-cut-audio-carrying-over-a-cutaway (vows),
restrained-title-card-on-black (for a closing date card). Never: whip or
glitch transitions, sub-second bursts, giant kinetic type, trailer booms,
dense whooshes, a beat-grid cut on every beat.

## Reference moments

Local only, in `~/zenvi-motion/refs2/wedding-event-film/`: `xactssi` (ignition
above the music 16.4 s, engine equal 19.4 s, crowd entering on the cut 64.0
and 84.5 s, macro hem to twirl 50.8 s, tighten 7.0 → 2.1 s then a 5.8 s aisle
hold 63.8-89.9 s); `x36zi7r` (names title over a sun-flare 11.5 s, dissolves
between prep details 26.0 s, hard cut on action 35.3 s, white flashes 10.9 /
19.1 / 57.5 s: one too many).

## Example (verified 2026-10-28)

See the end of this file once the judged example is in; build script:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/styles/wedding-event-film.build.sh`.
