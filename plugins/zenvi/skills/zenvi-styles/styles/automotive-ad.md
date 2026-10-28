---
id: automotive-ad
kind: style
summary: "For a car, motorbike or any machined product hero film: dark tease, light-up, macro details, held hero, quiet card."
categories: [automotive-ad]
tools: [set_project_setting_tool, gather_stock_footage_tool, search_freesound_music_tool, import_stock_media_tool, detect_beats_tool, add_clip_to_timeline_tool, color_grade_clip_tool, unify_grade_tool, add_vignette_tool, fade_clip_tool, set_keyframes_tool, speed_ramp_tool, align_match_cut_tool, add_sfx_tool, automate_volume_tool, add_kinetic_title_tool, add_motion_block_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: medium
mood: [premium, dark, powerful, restrained]
aspect: ["2.39:1", "16:9", "9:16"]
pairs_with: [T021, T105, T104, T046, T078, T025, T084, T061, T071]
avoid_with: [T045, T116, T127]
needs: []
---

# Automotive ad

A hero film for a machine: the car is lit out of darkness, shown in close
details, demonstrated, then revealed whole on the music's peak and signed
off with one quiet card. Hard cuts carry it; sound is selective and
mechanical; type is almost absent.

## When to use / not

Use for: car, motorbike, e-bike, watch or any engineered object with
surfaces, lights and moving parts; "launch film", "reveal", "premium",
"cinematic car". Not for: a dealer offer with prices (that is a promo), a
review (`tech-review`), a fast music edit of driving clips with flashes on
every beat (`sports-hype-edit` / the hype recipe), a narrative spot with
dialogue (borrow from `brand-story-corporate`).

## Structure (beats with timings)

Arc: tease in darkness → light-up → detail inserts → function demo →
tighten → stillness → hero reveal on the peak → end card. Percent of
runtime is the rule; the tables are that rule at four lengths.

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Tease (near-black, rim light, fog) | 0-2 | 0-3.5 | 0-7 | 0-10 |
| Light-up on one hit (T021) | 2 | 3.5 | 7 | 10 |
| Detail inserts, 1.2-2.5 s each | 2-6 | 3.5-11 | 7-24 | 10-36 |
| Function / interior with foley (T078) | 6-9 | 11-18 | 24-38 | 36-57 |
| Tighten: 0.4-1 s burst (T046) | 9-10.5 | 18-21.5 | 38-44 | 57-66 |
| Stillness before the peak | 0.4 | 0.5 | 0.75 | 0.75 |
| Hero reveal, 2.3-5 s holds, on the peak (70-85 %) | 11-13.5 | 22-27 | 45-54 | 67-81 |
| End card with sub drop or cymbal tail | 13.5-15 | 27-30 | 54-60 | 81-90 |

## Shot plan

- Mix: 45-65 % close and macro (wheel, grille, badge, lamp, seam, vents,
  shifter, door handle), 15-30 % medium, 15-25 % wide/aerial. Wides sit at
  the tease and the hero reveal only.
- Shot length median ~1.5 s (1.2-2 s), with a long tail: p90 at 1.9-3.5x the
  median. One 0.3-1 s burst and one 4-7 s hold in the same film.
- Static shots only when the light moves in them (LEDs sequencing, a rim
  sweep, fog drifting). Camera moves in the footage are slow: dolly, push-in,
  orbit. Add a 3-6 % push (`set_keyframes_tool` scale) on any held static.
- Source count: about one clip per 1.5 s of runtime plus 50 % spare; the
  same car (or one model) throughout. Mixed cars read as stock.
- Match cuts (T104) between old and new parts or two round parts at the
  same centre and scale, on a hit: 1 every 10-15 s at most.

## Look & grade

- Two families; pick one per film or travel deliberately from one to the
  other: low-key (mean luma ~45-55: night, teal shadows, amber lights) or
  high-key (luma ~100: white cyclorama, champagne). Going dark → white
  inside the film (T105 on a hit) is a strong arc.
- One accent colour: the car's paint or its lights is the only saturated
  hue (T025). Surroundings desaturated (saturation 0.6-0.8).
- `unify_grade_tool` first, then the look at 0.5-0.7; vignette 0.2 with
  feather 0.85 on a scope frame (0.4 reads as a fuzzy oval tunnel on 2.39:1). No
  grain on studio footage. Bloom/halation only on lights (`apply_fx_tool`
  bloom, CLI).
- Scope frame 2.39:1 (1920x804 or 1920x816) unless the platform is
  vertical; then 9:16 with the car centred.

## Type system

- Almost none: no overlay type for the first 50 % (90 % on films under 30 s).
- End card: product name or one tagline at 3.5-6 % of frame height,
  neo-grotesque sans (Inter), uppercase tracked or mixed case, fade or rise
  in over ~1 s, never a slam. Optional legal line 1.5-2 %.
- Hairline callouts (T071) only in a technical "feature" film: 1 px line,
  small mono labels, gone before the next cut.

## Motion & transitions

- Hard cuts, 85-96 %. Specials, one each at most: a whip inside an
  occluded pan, a match cut, a closing dissolve or fade into the card.
- No white flashes (0-1 per film), no glitch, no zoom punches between
  shots, no motion-transition chains.
- Speed ramp (`speed_ramp_tool` `hero`) on one drive shot at the peak.

## Sound & music

- Music: cinematic orchestral, hybrid trailer, dark synth or minimal drone;
  a bed that starts low, builds, peaks at 70-85 % of runtime and tails into
  the card. Cuts land on onsets (45-65 %), not on a beat grid (~20 %).
- Sound on 20-60 % of cuts, in the product's own vocabulary: relay ticks,
  door actuators, key, selector click, engine start, tyre on wet road,
  hits on the light-up and the reveal. Never a whoosh on every cut.
- Levels (CRAFT.md): music-led, bed at -14…-16 LUFS short-term; hero hits
  momentary -9…-11 LUFS (0 to +3 LU over the bed); mechanical close-mic
  foley at or above the bed (T078); whooshes 4 dB under the hero.
- Keep dynamics: one near-silent beat before the peak (`automate_volume_tool`
  `suck_out` or a dip of 0.4-0.8 s), loudness range high. Deliver
  `master_audio_tool` social (-14 LUFS, -1 dBTP).
- End: a sub drop or cymbal/piano decay on the card; music ends with it.

## Captions/VO

None. No VO, no captions, no slogans over the picture. A dialogue spot is a
different style.

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 816, "fps": 24}
gather_stock_footage_tool {"queries": ["black sports car headlights turning on dark", "sports car wheel rim close up", "car tail light detail night", "car interior steering wheel driving night", "sports car driving road at dusk", "car badge emblem close up", "car aerial drive mountain road", "sports car front view fog"], "count": 16, "orientation": "landscape", "min_seconds": 4}
search_freesound_music_tool {"query": "cinematic dark trailer build", "min_seconds": 40}
import_stock_media_tool {"source": "freesound", "sound_id": "<id>", "preview_url": "<url>", "position_seconds": 0, "start_seconds": 0, "duration_seconds": 30, "track": "4"}
detect_beats_tool {"file_id": "<music file>"}
```

Cut by hand, one `add_clip_to_timeline_tool` per row of the plan, each with
`start_seconds`/`end_seconds` on the moment you want (look at the clip's
contact sheet first). Lengths follow the beat table: tease 2-3.5 s, details
1.2-2 s, burst 0.4-0.8 s, hero 3-5 s.

```json
add_clip_to_timeline_tool {"file_id": "<headlight clip>", "position_seconds": 0, "start_seconds": 1.2, "end_seconds": 5.8, "track": "1"}
color_grade_clip_tool {"timeline_clip_id": "<tease>", "exposure": -0.3, "shadows": -0.5, "contrast": 0.25, "saturation": 0.6}
unify_grade_tool {"look": "teal_cinema", "look_intensity": 0.5}
add_vignette_tool {"amount": 0.2, "feather": 0.85}
fade_clip_tool {"clip_id": "<tease>", "fade_in_seconds": 0.8}
set_keyframes_tool {"timeline_clip_id": "<hero hold>", "property": "scale_x", "points": [{"timeline_seconds": 22, "value": 1}, {"timeline_seconds": 27, "value": 1.05}]}
set_keyframes_tool {"timeline_clip_id": "<hero hold>", "property": "scale_y", "points": [{"timeline_seconds": 22, "value": 1}, {"timeline_seconds": 27, "value": 1.05}]}
```

Sound by hand, selectively (light-up, 2-4 mechanical details, the
reveal, the card):

```json
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 3.5, "duration": 2.5, "gain_db": -18}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": 3.5, "pitch": -5, "gain_db": -6}
add_sfx_tool {"recipe": "hit_transient", "at_seconds": 3.5, "gain_db": -8}
add_sfx_tool {"recipe": "mouse_click", "at_seconds": 12.1, "pitch": -6, "brightness": 0.3, "gain_db": -10}
add_sfx_tool {"recipe": "whoosh_long", "at_seconds": 22, "gain_db": -12}
automate_volume_tool {"track": "4", "shape": "suck_out", "at_seconds": 22, "length_ms": 500, "db": -18}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": 22, "gain_db": -5}
add_sfx_tool {"recipe": "sub_drop", "at_seconds": 27, "gain_db": -6}
```

End card (black, the name at ~5 % height):

```json
add_kinetic_title_tool {"text": "<NAME>", "position_seconds": 27, "duration_seconds": 3, "style": "documentary", "animation": "rise", "text_size": 0.05, "background": "#050505"}
master_audio_tool {"preset": "social", "iterate": true}
review_edit_tool {}
```

Then render and `review_render_tool` on the file; one fix pass.

## Finish checklist

- [ ] Sound on 20-60 % of cuts, mechanical and specific; no whoosh carpet.
- [ ] One near-silent beat before the peak; the mix is not flat.
- [ ] Shot lengths vary: a burst under 1 s and a hold over 4 s; p90 ≥ 1.9x median.
- [ ] No overlay type in the first half; one card at 3.5-6 % height at the end.
- [ ] Hero reveal lands at 70-85 % of runtime on the loudest hit.
- [ ] No dead static: every held shot has light or camera moving.
- [ ] Match cuts register the shape at the same place and size.
- [ ] One accent hue; no all-over saturation boost; tease dark, hero not muddy.
- [ ] One end card 3-6 s with one sound button; nothing after it.
- [ ] Delivered at -14 LUFS, true peak ≤ -1 dBTP.

## Mix-and-match

Borrow: T021 (opening), T105 (dark to white jump), T104 (shape match),
T078 (close-mic foley), T046 (tighten then release), T025 (accent grade),
T084 (music stops dead for a story beat), T061 (card), T071 (hairline
callouts for a tech film), T003 (model-year chapters, needs a 3D morph).
Never: T045 strobe bursts with flash frames, T116/T127 giant kinetic type,
glitch transitions, whoosh-on-every-cut sound design, captions.

## Reference moments

Local only, in `~/zenvi-motion/refs2/automotive-ad/`: `x8557el` (luxury SUV
hero film; light-up 15.9 s, door-handle foley 22.2 s, white-room hero
49.8 s, bloom to the card 56.6 s); `2111084768947322880` (vertical studio
film; light-up 5.1 s, black-to-white jump 8.8 s, cockpit burst 23.9-35.2 s);
`1426136418410237953` (heritage reveal; shape matches 33.3 and 36.3 s,
0.3 s burst 46.8 s, hero 69.8 s, 3D crest 74.8 s); `x88siqh` (design film;
latch foley 29.8 s, sub drop on the card 58.4 s); `x7r65a1` (narrative
spot; music off 56.6 s, brass re-entry 70.3 s); `x7v1ev8` (one-shot CGI
model morphs every 8-15 s).

## Example (verified 2026-10-28)

30 s at 1920x816 from 17 mixed Pexels car clips and a CC BY build track
(`~/zenvi-motion/fleet/artifacts/sk2-product-brand/styles/automotive-ad.*`, build script in the PR). Watch judge 3.6/10 absolute;
pairwise 3.8 against the reference hero film (8.4). Structure, light-up and
foley read; it loses on mixed car models (the judge's main complaint), a
0.4 vignette that read as an oval tunnel (now 0.2/0.85 above) and a burst that
reused two shots. With one car's footage the sequence needs no new tool.
