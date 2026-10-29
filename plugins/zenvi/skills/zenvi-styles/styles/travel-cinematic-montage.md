---
id: travel-cinematic-montage
kind: style
summary: "For a trip, city or destination film: one metronomic cut cadence, rule changes in blocks, one grade, a long last shot."
categories: [travel-cinematic-montage]
tools: [set_project_setting_tool, gather_stock_footage_tool, search_freesound_music_tool, import_stock_media_tool, detect_beats_tool, add_clip_to_timeline_tool, set_clip_properties_tool, set_keyframes_tool, unify_grade_tool, apply_motion_transition_tool, add_kinetic_title_tool, add_sfx_tool, fade_clip_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: fast
mood: [adventurous, uplifting, wanderlust, rhythmic]
aspect: ["16:9", "2.39:1", "9:16", "4:5"]
pairs_with: [vector-switch-chapters, telephoto-scale-jump-with-riser-to-hit, bar-phrase-and-lyric-locked-cutting, foreground-occluder-cut-in-footage, zoom-through-scene-chain, tighten-then-release-into-held-payoff, beat-staggered-tile-and-slice-build]
avoid_with: [karaoke-word-highlight-captions, giant-word-kinetic-statement, staccato-keyword-list-punch, commentary-hits-with-dense-designed-cues]
needs: [shot-heading-scale-tagger, walking-person-center-align, stills-hyperlapse-zoom]
---

# Travel cinematic montage

A music-led film where a repeating device turns unrelated places into a
rhythm: one cut interval for the whole piece, a rule (walking axis, camera
path, framing) that changes in blocks every 5-20 s, one grade, almost no
text, and the longest shot saved for the end.

## When to use / not

Use for: trips, city and destination films, tourism spots, "cinematic travel
edit", "my trip to …", hotel or region promos without dialogue. Not for: a
vlog with talking (`talking-head-captions`), a guide with facts and maps
(`map-data-explainer`), a property (`real-estate-tour`), a hype edit with
flashes on every beat (`sports-hype-edit`).

## Structure (beats with timings)

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Establishing hold (one shot, subject moving away / into the place) | 0-1.5 | 0-2 | 0-2 | 0-3 |
| Rule established: same cadence, block 1 (e.g. walking away) | 1.5-5 | 2-8 | 2-15 | 3-20 |
| Block 2: axis or subject class changes (profile, toward camera) | 5-8 | 8-12 | 15-21 | 20-32 |
| Scale event: telephoto push or zoom-through with riser to hit | 8-10 | 12-17 | 21-30 | 32-45 |
| Block 3-4: aerial geometry, then the intimate turn (portraits, details) | 10-12 | 17-24 | 30-50 | 45-78 |
| Release: the longest shot, 3-13x the median | 12-15 | 24-28.5 | 50-57 | 78-86 |
| End card (optional, black, title ~13 % height) | – | 28.5-30 | 57-60 | 86-90 |

A new block every 5-20 s, each switch on a downbeat; at least 3 rule
changes per 60 s.

## Shot plan

- Cadence: one interval for the piece, a whole number of beats: 1 beat at
  ~120 bpm (0.5 s) for a match-cut walk, 2 beats (1.0 s) for city
  vignettes, a bar or more (2-3 s) for a slower essay. Break it once.
  Standard deviation of shot length inside a block under 15 %.
- Blocks by direction and scale: walking away, profile left-to-right,
  toward camera, aerial geometry, portraits / intimate details. Sort the
  bin by looking at contact sheets (no tool tags heading yet:
  `shot-heading-scale-tagger`).
- One motion mode: either every shot moves (gimbal, drone, hyperlapse) or
  every shot is locked. Cut on motion, not between two still frames.
- Subject registration for a match-cut walk: same point of the frame on 80 %
  of cuts (`walking-person-center-align` is missing; pick clips that already
  match, or scale/offset by hand with `set_clip_properties_tool`).
- Source count: one clip per cut plus 30 % spare; 1.0 s cadence over 30 s =
  25-30 clips.

## Look & grade

- One look across every clip: `unify_grade_tool` first, look at 0.4-0.5
  (`warm_cinema` for sun, `teal_cinema` for cities at night). Luma spread
  within about 30 of the median.
- No grain on drone footage; vignette none or 0.15. Fill the frame
  (`scale` `Crop`) when sources and frame aspect differ.

## Type system

Clean frame: text on screen under 10 % of the runtime. At most a title at
the start or an end card on black at ~13 % of frame height (`text_size`
0.13 on 16:9), one face, fade only. No captions, no watermark, no location
labels on every shot.

## Motion & transitions

- Hard cuts. The cadence is the transition.
- Specials, 1-3 per 30 s, only on block changes: a zoom-through into a
  doorway (`apply_motion_transition_tool` `zoom_through` with `focus_x/y`
  on the door), an occluder wipe found in the footage, an axis match.
- Telephoto scale jump (`telephoto-scale-jump-with-riser-to-hit`): expo
  scale push 1 → 2.2 over 3-7 s on a wide with a clear target, cut on the
  hit into a close shot of the place.

## Sound & music

- Music-led: one bed, 110-130 bpm, start it on a downbeat (`detect_beats_tool`
  on the file, then `start_seconds` = a downbeat). Cuts land on beats; 70 %+
  on onsets.
- Two densities: a music-only piece takes 2-3 cues per minute (a riser and
  hit on the scale event, maybe an ambience under the release). A sound-led
  hyperlapse piece takes 11-13 per minute, risers before scale changes and
  hits on arrival. Never a whoosh on every cut at 25+ cuts per minute.
- Levels (CRAFT.md): bed -14…-16 LUFS short-term; hits 0 to +3 LU over it;
  risers under the bed. Master `social` (-14 LUFS, -1 dBTP); true peak 0.0 is
  a flaw.

## Captions/VO

None. If the brief insists on VO, use 1-2 lines and borrow the voice-over
mix from `video-essay-explainer`.

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 1080, "fps": 24}
gather_stock_footage_tool {"queries": ["person walking away city street backpack", "walking old town alley", "walking profile wall street", "drone aerial city skyline", "aerial coast cliffs ocean", "temple aerial", "train window travel landscape", "hiker mountain summit", "person walking beach", "market street crowd"], "count": 24, "orientation": "landscape", "min_seconds": 4, "max_seconds": 30}
search_freesound_music_tool {"query": "upbeat indie adventure", "min_seconds": 40, "bpm_range": "110-130"}
import_stock_media_tool {"source": "freesound", "sound_id": "<id>", "preview_url": "<url>"}
detect_beats_tool {"file_id": "<music>"}
```

Then one `add_clip_to_timeline_tool` per cut, back to back, each exactly
2 beats long (at 24 fps 120 bpm a 1.0 s cut is 24 frames):

```json
add_clip_to_timeline_tool {"file_id": "<walk away 1>", "position_seconds": 2, "start_seconds": 3, "end_seconds": 4, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
set_keyframes_tool {"timeline_clip_id": "<skyline wide>", "property": "scale_x", "points": [{"timeline_seconds": 12, "value": 1}, {"timeline_seconds": 15.5, "value": 2.2}], "ease": "ease_in_expo"}
set_keyframes_tool {"timeline_clip_id": "<skyline wide>", "property": "scale_y", "points": [{"timeline_seconds": 12, "value": 1}, {"timeline_seconds": 15.5, "value": 2.2}], "ease": "ease_in_expo"}
set_keyframes_tool {"timeline_clip_id": "<release>", "property": "scale_x", "points": [{"timeline_seconds": 24, "value": 1}, {"timeline_seconds": 28.5, "value": 1.06}]}
unify_grade_tool {"look": "warm_cinema", "look_intensity": 0.45}
add_kinetic_title_tool {"text": "<PLACE>", "position_seconds": 28.5, "duration_seconds": 1.5, "style": "documentary", "animation": "fade", "emphasis": "none", "text_size": 0.13, "background": "#000000", "stagger_seconds": 0}
add_clip_to_timeline_tool {"file_id": "<music>", "position_seconds": 0, "start_seconds": 0.836, "end_seconds": 30.836, "track": "5"}
fade_clip_tool {"clip_id": "<music>", "fade_out_seconds": 1.2}
add_sfx_tool {"recipe": "riser_noise", "at_seconds": 15.5, "duration": 2.0, "gain_db": -16}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 15.5, "gain_db": -10}
add_sfx_tool {"recipe": "sub_drop", "kit": "synth", "at_seconds": 15.5, "gain_db": -10}
master_audio_tool {"preset": "social", "balance": "keep"}
review_edit_tool {}
```

Render and `review_render_tool`; one fix pass.

## Finish checklist

- [ ] One cut interval per block, deviation under 15 %; broken once on purpose.
- [ ] A repeating device (subject position, camera path or frame) on most cuts.
- [ ] One motion mode: > 85 % of shots move, or > 85 % are locked.
- [ ] Motion present at the cut frame on ≥ 70 % of cuts.
- [ ] ≥ 3 rule changes per 60 s, each on a downbeat.
- [ ] Longest shot in the last 15 %, ≥ 3x the median.
- [ ] Cue density matches the mode (music-only 2-3 per minute); no whoosh carpet.
- [ ] Text under 10 % of runtime; no watermark.
- [ ] One look, luma spread within ~30 of the median.
- [ ] Cuts on onsets ≥ 70 %; master -14 LUFS, true peak ≤ -1 dBTP.

## Mix-and-match

Borrow: vector-switch-chapters, telephoto-scale-jump-with-riser-to-hit,
bar-phrase-and-lyric-locked-cutting, foreground-occluder-cut-in-footage,
zoom-through-scene-chain (on a doorway only), tighten-then-release-into-held-payoff,
beat-staggered-tile-and-slice-build (social cut-downs), the cinematic family's
speed ramps on the release. Never: captions, giant type, comic or UI
graphics, dense designed cues on a music-only cut, mixed looks per clip.

## Reference moments

Local only, in `~/zenvi-motion/refs2/travel-cinematic-montage/`: `27246366`
(match-cut walk at 0.5 s, axis switches 15.5 / 20.5 / 39.5 s, 6.5 s landscape
release 50 s, end card 56.5 s); `98123388` (hyperlapse: portal zoom-through
34.8 s, telephoto scale jump with riser to hit 39.4-46.1 s); `166929892`
(occluder cuts 12.3 / 36.4 s, axis match 55.1 s, tonal turn by compression
37.8-50 s, 4.9 s drone pull-up release); `104088954` (3.0 s bar-locked
cadence through a viewfinder frame).

## Example (verified 2026-10-28)

See the end of this file once the judged example is in; build script:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/styles/travel-cinematic-montage.build.sh`.
