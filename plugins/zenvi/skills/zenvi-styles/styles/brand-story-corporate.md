---
id: brand-story-corporate
kind: style
summary: "For a brand film or company story: people first, product enters late as a tool, foley on actions, short lockup."
categories: [brand-story-corporate]
tools: [set_project_setting_tool, gather_stock_footage_tool, search_clip_scenes_tool, slice_clip_at_best_match_tool, add_clip_to_timeline_tool, set_keyframes_tool, speed_ramp_tool, apply_motion_transition_tool, unify_grade_tool, apply_look_tool, add_kinetic_title_tool, kinetic_captions_tool, add_motion_block_tool, text_behind_subject_tool, search_freesound_music_tool, import_stock_media_tool, add_sfx_tool, automate_volume_tool, duck_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: medium
mood: [warm, human, hopeful, confident]
aspect: ["16:9", "9:16"]
pairs_with: [T049, T100, T081, T047, T045, T061, T059, T002, T082, T117]
avoid_with: [T116, T127, T112, T106]
needs: [action-foley-spotter, screen-quad-zoom-through]
---

# Brand story / corporate

A film about people, in which the brand is the tool that changes their
day. A human-scale hook with a change in picture and sound, stakes in
people, the product entering late (about 40 % in) on a motivated match or
punch, a demo cut with reactions, the result shown in people, and a short
lockup on the last action. Foley on real actions, type rationed, one
palette with grain.

## When to use / not

Use for: "brand film", "about us", "our mission", "company story",
recruitment, a product shown through a customer's day, an education or
nonprofit story. Not for: a feature-led launch (`product-launch-film`,
`saas-app-launch`), a hype montage, a talking-head explainer (the
documentary recipe). A motion-graphic brand piece (logos, type, 3D
carousels) keeps this arc but borrows the SaaS type and transitions, and
then hits sound on cuts.

## Structure (beats with timings)

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Hook / disruption: a human moment, picture and sound change | 0-1.5 | 0-3 | 0-7 | 0-10 |
| Setup / problem: stakes in people | 1.5-5 | 3-10 | 7-21 | 10-31 |
| Product enters, as a tool in an action (14-57 %, median 41 %) | 5-7 | 10-13 | 21-25 | 31-37 |
| Demo / proof: use cut with reactions, screens ≤ 2 s | 7-10 | 13-22 | 25-50 | 37-77 |
| Payoff: the result, in people | 10-12 | 22-25.5 | 50-55 | 77-82 |
| End card / lockup, ~5 s, on the last action | 12-15 | 25.5-30 | 55-60 | 82-90 |

## Shot plan

- Live story films cut fast: median shot ~1.4 s (p10 0.7, p90 ~4), 26-40
  cuts per minute, with one held hero beat of 3-5 s near the middle
  (a pour, a diagram, a face).
- Mix: medium and medium-close ~30 %, screens/UI ~25-30 % (each 0.9-3 s,
  median 1.5 s, intercut with people), close/insert ~15 %, wide ~10 %,
  overhead/OTS the rest.
- ~3 in 4 photographed shots carry a move (push-in the most common);
  statics are for punch lines and UI holds. Add a 3-6 % push on stills.
- Momentum cuts keep the direction of travel across the frame edge
  (wide → tracking legs → heel strike, T049).
- Source: one clip per ~1.4 s plus 50 %; the same people across the film
  (one family of stock: same talent, same location).

## Look & grade

- One palette per piece: warm golden practicals with teal/mint walls, or
  low-key navy and amber (live reels sit at luma ~50-80); the saturated
  accent is reserved for the hero element.
- `unify_grade_tool` first, then a warm film look at 0.5-0.6
  (`warm_cinema`, `golden_years_film`, `standard_film`), grain or halation
  on live footage (`apply_fx_tool` `light_leak` sparingly; grain via the
  look). Luma spread across shots within ~±15 of the median.

## Type system

- Rationed: zero overlays in the live story, or ≤ 5 type events in 40 s.
- Slam cards on black for a pivot: one phrase, 5.5-9 % height, 1.0-1.6 s,
  geometric sans (`add_kinetic_title_tool` `style: "documentary"` or
  `"stack"`, `background: "#000000"`).
- Captions only when VO carries the film: 3-3.5 % height, word pairs in
  the negative space, face clear (`kinetic_captions_tool`).
- Motion-graphic brand pieces: hero type 12-45 %, 3-8x the support lines.
- Lockup: logo or wordmark ~5 %, one-line sign-off, URL.

## Motion & transitions

- Hard cuts ~70 %; match cuts at the product entrances (device to screen,
  T100; slow-mo subject to its illustration); a whip into a routine
  montage once (T045 burst of 0.5-1 s shots); dissolves only at section
  ends; 1-3 white flashes per 90 s at most.
- Speed ramp (`speed_ramp_tool` `hero`) on the one slow-motion hero beat.

## Sound & music

- Music: restrained opening (pad, drone or silence under a line), a surge
  at the first turn, a groove through the demo, a drop-out or dip for the
  hero product beat, a bass hit or chime on the logo. Cuts follow phrases
  and actions (~19 % on beat, ~54 % on onsets).
- Live story: real foley on real actions (marker, tap, keys, pour, foil,
  footsteps; T081), at or under the music; whooshes only on physical
  motion (≤ 3 per 90 s). ~10-15 cues per minute, well under one per cut.
  Motion-graphic brand piece: synth hits on cuts and entrances (cue
  coverage ≥ 1.5x chance).
- Levels: music-led bed -14…-16 LUFS; foley "under/equal", the hero
  product sound (tear, pour) "above" (+0-3 LU); with VO, voice -15 LUFS and
  the bed ducked 6-10 dB (`duck_tool` `target_vbr_db` 10).
- Master -14 LUFS, ≤ -1 dBTP. One deliberate dip (`automate_volume_tool`
  `dip`) under the hero product shot.

## Captions/VO

Half the references have no VO (music + foley + dialogue lines). With VO:
~140 wpm, warm and plain; captions burned in at 3-3.5 % in negative space;
the bed ducks and returns around speech.

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 1080, "fps": 24}
gather_stock_footage_tool {"queries": ["teacher classroom morning warm light", "students working together laptop", "hands typing laptop close up", "student smiling discovery", "classroom wide sunlight", "tablet drawing hand close up"], "count": 18, "orientation": "landscape", "min_seconds": 4}
search_freesound_music_tool {"query": "warm acoustic indie uplifting", "min_seconds": 40}
import_stock_media_tool {"source": "freesound", "sound_id": "<id>", "preview_url": "<url>", "position_seconds": 0, "start_seconds": 0, "duration_seconds": 30, "track": "5"}
```

Cut by hand, one `add_clip_to_timeline_tool` per row of the plan (median
1.4 s, one 3-5 s hero hold). Product entrance as a match or punch:

```json
add_clip_to_timeline_tool {"file_id": "<over-the-shoulder tablet>", "position_seconds": 10, "start_seconds": 2, "end_seconds": 3.4, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<screen recording>", "position_seconds": 11.4, "start_seconds": 0, "end_seconds": 1.6, "track": "1"}
apply_motion_transition_tool {"track": "1", "time": 11.4, "preset": "zoom_through", "intensity": 0.6}
unify_grade_tool {"look": "warm_cinema", "look_intensity": 0.55}
add_sfx_tool {"recipe": "ui_tap", "at_seconds": 11.4, "gain_db": -14}
add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 14.2, "gain_db": -16}
add_sfx_tool {"recipe": "paper", "at_seconds": 16.8, "gain_db": -16}
automate_volume_tool {"track": "5", "shape": "dip", "start_seconds": 17.5, "end_seconds": 20.5, "db": -8}
add_kinetic_title_tool {"text": "Every class, a little brighter.", "position_seconds": 25.5, "duration_seconds": 2, "style": "documentary", "animation": "rise", "text_size": 0.05}
add_motion_block_tool {"block": "logo_reveal_end", "position_seconds": 27.5, "duration_seconds": 2.5, "params": {"brand": "<Brand>", "cta": "", "url": "<brand>.com", "palette": "cream"}}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 27.5, "gain_db": -9}
master_audio_tool {"preset": "social", "iterate": true}
review_edit_tool {}
```

Keyframe times must sit inside the clip: end a push one frame before
the clip's last frame, or `set_keyframes_tool` refuses. Spot the in-picture actions by eye (`preview_frame` or each clip's contact
sheet: a tap, a key, a pour): there is no action spotter yet
(`action-foley-spotter`), and `spot_sound_tool` sees cuts and titles, not
hands. Render, `review_render_tool`, one fix pass.

## Finish checklist

- [ ] The hook changes picture and sound inside the first 12 %.
- [ ] Brand/product first appears after the first third (story films).
- [ ] Screens are as short as people shots (median ≤ 2 s), intercut with people.
- [ ] The product enters on a motivated match or punch, with a sound within 150 ms.
- [ ] Every product event has a sound; whooshes only on physical motion.
- [ ] One held beat of 3 s or more near the middle; p90/median 1.5-3.2.
- [ ] < 40 % fully static live shots.
- [ ] Type rationed; captions only with VO, face clear.
- [ ] One palette, grain on live footage, luma spread within ~±15.
- [ ] Lockup ~5 s (≤ 10 % of runtime on 50 s+), on the last action, with a hit.
- [ ] -14 LUFS, ≤ -1 dBTP; with VO the bed ducks ≥ 6 dB.

## Mix-and-match

Borrow: T049 wide-to-macro momentum cut, T100 match into a screen, T081
foley on actions, T047 word-keyed cutaway (with VO), T045 routine burst
into a whip, T059 HUD chips on live footage, T002 exploded mockup (motion
brand piece), T061 lockup, T082 L-cut, T117 black chapter cards. Never:
T116/T127 giant kinetic type over a live story, T112 verdict cards, T106
warp tunnels, whooshes on every cut of a live narrative.

## Reference moments

Local only, in `~/zenvi-motion/refs2/brand-story-corporate/`:
`education-discover-apple-education` (education brand film; calm hook
then birds and music surge 7.4 s, device-to-screen match 17.2 s, overhead
crane at the demo turn 39.2 s, slow-mo bird to vector diagram match
56.7 s, typing title with key clatter 78.4 s, Return punch 82.5 s);
`Deq9CiUzzvG` (24 s product spot; wide-to-tracking momentum cut 2.2 s,
tabletop pour with music drop 12.8 s, logo on the last action 21.4 s with
a bass hit 21.8 s).

## Example (verified 2026-10-28)

25 s from 14 Pexels classroom clips, a tablet entering at 10.2 s on a
zoom-through, warm look, foley on paper/taps, CC BY acoustic track
(`~/zenvi-motion/fleet/artifacts/sk2-product-brand/styles/brand-story-corporate.*`). Watch judge 3.4/10: flat hallway hook with
no sound, grade and resolution jumps between stock sources. Stock from
many shoots is this style's weak point; the same people and place
throughout matter more than any tool.
