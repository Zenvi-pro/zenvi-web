---
id: real-estate-tour
kind: style
summary: "For a house, apartment, hotel or venue tour: arrival hook, forward-moving room chain, action foley, a held reveal."
categories: [real-estate-tour]
tools: [set_project_setting_tool, gather_stock_footage_tool, search_freesound_music_tool, import_stock_media_tool, detect_beats_tool, add_clip_to_timeline_tool, set_clip_properties_tool, unify_grade_tool, set_keyframes_tool, add_kinetic_title_tool, search_sound_library_tool, search_sfx_tool, add_sfx_tool, automate_volume_tool, fade_clip_tool, transcribe_media_tool, add_captions_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: medium
mood: [aspirational, warm, calm, premium]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [held-orbit-or-ascending-reveal, foley-spotted-to-in-frame-actions, accelerating-cut-length-ramp, diegetic-sound-carries-the-cut, whip-transition-motion-blur-smear, sentence-level-interview-subtitles]
avoid_with: [white-flash-or-light-leak-join, giant-word-kinetic-statement, staccato-sub-second-shot-burst, single-accent-palette-grade]
needs: [motion-peak-cut-snap, transcript-broll-inserter]
---

# Real-estate tour

A property film that feels like walking through it: arrive, open the door,
glide forward room by room with the shots shortening as the rooms get
private, hear the house being used (a stove click, a tap, a latch), and let
one long aerial or orbit land the whole place at the end. Bright, clean,
nearly no text, no ornament.

## When to use / not

Use for: house, apartment, villa, hotel, Airbnb, venue and office-space
tours, "luxury listing video", "property walkthrough". Not for: an
architecture documentary with interviews (borrow `documentary-true-story`
and the subtitles technique), a renovation before/after (split-screen
techniques), a city or travel film (`travel-cinematic-montage`).

## Structure (beats with timings)

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Arrival hook: vehicle / gate, then drone descent; no text | 0-3 | 0-6 | 0-7 | 0-7 |
| Host or invitation: door handle turn, POV step inside | 3-4.5 | 6-9 | 7-15 | 7-15 |
| Lifestyle proof (people using the house) | – | – | 15-30 | 15-46 |
| Room chain, forward glides, 4 s → 2 s | 4.5-11 | 9-23.5 | 30-50 | 46-72 |
| Action inserts with foley inside the chain (1.5-3 s) | in chain | 16-18 | 2-3 inserts | 3-4 inserts |
| Held reveal: orbit or ascending drone, 6-18 s, music swells | 11-15 | 23.5-30 | 50-60 | 72-90 |

The held reveal scales with length: 4 s at 15 s, 6.5 s at 30 s, 10-12 s at
60 s, 12-18 s at 90 s (`held-orbit-or-ascending-reveal`).

## Shot plan

- Every non-host shot moves: forward gimbal glides inside, drone moves
  outside. All interior moves in one direction (forward) so cuts read as one
  walk; no static wides.
- Room chain lengths: start ~4 s (living), tighten to ~2 s (bed, bath,
  closet). Shot median 2.5-3.5 s at 30 s.
- People using the house: 2-6 shots of hands or figures (cooking, pouring,
  opening a door), each with its foley.
- A detail insert (fixture, texture, macro) after 2-4 wides resets scale.
- One property. Mixed houses read as stock: keep exteriors and the reveal
  from the same home, and pick interiors of one finish.

## Look & grade

- Bright and clean: mean luma ~120-135 on interiors, lifted shadows, natural
  saturation; windows may clip a little.
- `unify_grade_tool` with `sunlit_cinema` at 0.3 (or no look, correction
  only). No grain, no vignette, no teal-orange, no accent grade.
- Twilight exterior keeps its own blue-hour grade; do not unify it with day.

## Type system

- Best tours show no text. When the brief needs it: one property name or
  address line at 2.8-4 % of frame height, lower third, under 3 s,
  `add_kinetic_title_tool` style `documentary`, `text_size` 0.032, `y` 0.86.
- Price / beds / baths on the end card only; never over the hook.

## Motion & transitions

- Hard cuts (28 of 30 in the best tour), hidden on action: the door handle
  turn, a glide into the next room.
- One dissolve at a time-of-day jump (day macro → twilight exterior,
  0.5 s).
- A whip pan only at a spoken pivot ("come with me"), with a whoosh.
- Slow push on the held reveal if the move itself is slow.

## Sound & music

- Music: warm acoustic guitar or soft piano, 100-120 bpm, steady; one bed,
  fade in 0.5 s, swell +3 dB under the reveal (`automate_volume_tool`
  `swell`), fade out 1.5 s.
- Two audio worlds: an ambience bed under exteriors (birds, wind, pool
  water; -30…-38 LUFS) and sharp foley on every action at or 0-3 dB over the
  music, starting 0.3-1.0 s after the cut, on the action frame. Stock rarely
  has usable sound: `search_sound_library_tool` (door, car, ambience) and
  `search_sfx_tool` (latch, gas stove, tap) for real recordings.
- Cue density ~0.4 per cut, foley on 100 % of action inserts; whoosh only
  on the door step-in, far under the bed.
- Master -14 LUFS, true peak ≤ -1 dBTP (a best-in-set tour peaks at -0.3:
  do not copy that).

## Captions/VO

Optional: a host or agent to camera between rooms (cut on sentence ends,
`transcribe_media_tool` for the ends), or an architect interview with
sentence-level subtitles at ~2.8 % height (`add_captions_tool`). Inserts that
illustrate the spoken noun need `transcript-broll-inserter` (missing).

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 1080, "fps": 24}
gather_stock_footage_tool {"queries": ["luxury house exterior drone", "car arriving house driveway", "front door opening entrance", "modern living room interior walkthrough", "luxury kitchen interior", "person cooking kitchen stove", "modern bedroom interior", "luxury bathroom", "villa swimming pool", "aerial orbit house pool"], "count": 20, "orientation": "landscape", "min_seconds": 4, "max_seconds": 30}
search_freesound_music_tool {"query": "acoustic guitar warm", "min_seconds": 40}
import_stock_media_tool {"source": "freesound", "sound_id": "<id>", "preview_url": "<url>"}
detect_beats_tool {"file_id": "<music>"}
```

Cut on bars (120 bpm: 2 s), the chain tightening:

```json
add_clip_to_timeline_tool {"file_id": "<car arriving>", "position_seconds": 0, "start_seconds": 5, "end_seconds": 8, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<living glide>", "position_seconds": 9, "start_seconds": 1, "end_seconds": 5, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<aerial orbit>", "position_seconds": 23.5, "start_seconds": 6, "end_seconds": 12.5, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
unify_grade_tool {"look": "sunlit_cinema", "look_intensity": 0.3}
add_clip_to_timeline_tool {"file_id": "<music>", "position_seconds": 0, "start_seconds": 1.057, "end_seconds": 31.057, "track": "5"}
fade_clip_tool {"clip_id": "<music>", "fade_in_seconds": 0.5, "fade_out_seconds": 1.5}
automate_volume_tool {"clip_ids": "<music>", "shape": "swell", "start_seconds": 23.5, "end_seconds": 28.5, "db": 3}
search_sound_library_tool {"category": "ambience", "count": 20}
add_sfx_tool {"provider": "kit", "sound_id": "<car arriving ambience>", "at_seconds": 0, "gain_db": -16}
search_sfx_tool {"query": "door latch", "count": 5}
add_sfx_tool {"provider": "openverse", "sound_id": "<id>", "title": "<title>", "at_seconds": 7.4, "gain_db": -6}
add_sfx_tool {"provider": "openverse", "sound_id": "<gas stove id>", "title": "<title>", "at_seconds": 16.4, "gain_db": -6}
add_kinetic_title_tool {"text": "<Property name>", "position_seconds": 26.5, "duration_seconds": 3, "style": "documentary", "animation": "fade", "emphasis": "none", "text_size": 0.032, "y": 0.86, "stagger_seconds": 0}
master_audio_tool {"target_lufs": -14, "true_peak_dbtp": -1.0, "balance": "keep"}
review_edit_tool {}
```

Render and `review_render_tool`; one fix pass.

## Finish checklist

- [ ] No static non-host shot; interior moves all forward.
- [ ] People use the house in 2+ shots, each with its own foley.
- [ ] ~0.4 cues per cut; foley on every action insert, on the action frame.
- [ ] Room chain tightens (~4 s → ~2 s); the reveal is the longest shot.
- [ ] Hard cuts hidden on action; whip only at a spoken pivot.
- [ ] Text absent or ≤ 4 % height and < 3 s.
- [ ] Bright: interior mean luma ~120-135, shadows open, no grain / vignette.
- [ ] Ambience bed under exteriors, foley above it.
- [ ] True peak ≤ -1 dBTP, -14 LUFS.
- [ ] One property throughout.

## Mix-and-match

Borrow: held-orbit-or-ascending-reveal, foley-spotted-to-in-frame-actions,
accelerating-cut-length-ramp (the room chain), diegetic-sound-carries-the-cut
(car or gate in the hook), whip-transition-motion-blur-smear (one, at a
spoken pivot), sentence-level-interview-subtitles (architect film). Never:
white flashes, accent grades, grain, giant type, bursts, trailer booms.

## Reference moments

Local only, in `~/zenvi-motion/refs2/real-estate-tour/`: `x92kpma` (arrival
hook 0-7.1 s, door-handle handoff 45.4-53.8 s, room chain 4 s → 2 s
53.5-90 s, stove click and gas 77.2 s, day macro to twilight dissolve 42.8 s);
`x89xgk9` (architecture documentary: 18 s held orbit landing the thesis
59.2-77.2 s, sentence-level subtitles 22.8 s); `x8mt1pz` (host anchor and
b-roll carousel 0-10.9 s, whip pivot with three inserts 67.2-79.7 s).

## Example (verified 2026-10-28)

30 s at 1920x1080 from 11 Pexels house clips and a CC BY 4.0 guitar bed (Freesound 746694, ViraMiller): `~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/styles/real-estate-tour.*` (render, contact sheet, judge and pairwise JSON, build script). Watch judge 3.5/10 absolute (v1 2.8, foley missing and an over-graded pool shot); pairwise 3.1 against the reference luxury tour (6.2). Foley now reads; the judge's main complaint is that every cut shows a different house, and a phone-style POV door shot that does not match the interiors. With one property's footage this sequence needs no new tool; with stock, keep exteriors and the reveal from one house and drop any shot whose camera clearly differs.
