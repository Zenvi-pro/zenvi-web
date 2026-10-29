---
id: tech-review
kind: style
summary: "For a gadget review or hands-on: verdict in 3 s, presenter plus claim-synced inserts, one card style, buy-or-skip."
categories: [tech-review]
tools: [set_project_setting_tool, transcribe_media_tool, get_transcript_tool, generate_tts_and_add_to_timeline_tool, gather_stock_footage_tool, search_freesound_music_tool, search_clip_scenes_tool, add_clip_to_timeline_tool, split_clip_tool, set_clip_properties_tool, add_motion_block_tool, add_kinetic_title_tool, kinetic_captions_tool, unify_grade_tool, add_sfx_tool, duck_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: medium
mood: [informative, honest, crisp, friendly]
aspect: ["16:9", "9:16"]
pairs_with: [T047, T041, T112, T071, T068, T125, T082, T050, T119]
avoid_with: [T021, T084, T023, T045]
needs: [tracked-point-callout-pin, paper-cut-wiggle-text]
---

# Tech review

A presenter-led review: the verdict lands in the first 3 s, then features
are told in claim-synced inserts (each spoken claim cuts to the clip that
shows it with a small card on the same frame), caveats on camera with a
punch-in, price, a buy-or-skip pivot, a breakdown, and a close on the price
or a hero close-up. Speech drives the cuts; sound sits on graphics, not on
plain cuts.

## When to use / not

Use for: phone, TV, earbuds, drone, laptop, app reviews; "review",
"hands-on", "is it worth it", "first impressions", "versus". Not for: a
brand's own launch film (`product-launch-film`), a tutorial (tutorial
recipe), an unscripted vlog. Needs a voice: the user's talking head or a
TTS script.

## Structure (beats with timings)

| beat | 15 s (short) | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Verdict hook: product + stance ("solid upgrade") | 0-2 | 0-3 | 0-3 | 0-3 |
| Feature rundown: inserts 1.9-2.9 s, one card each (T047) | 2-8 | 3-12 | 3-15 | 3-20 |
| Caveats / positioning on camera, one punch-in (T041) | — | 12-17 | 15-27 | 20-37 |
| Chapter bumper 2.9 s (optional) | — | — | 27-30 | 37-40 |
| Price and comparison: price pill, rival cutaway | 8-11 | 17-21 | 30-38 | 40-52 |
| Buy-or-skip pivot (T112), 2.7 s, ~50 % in | 11-13 | 21-23.5 | 38-41 | 52-55 |
| Breakdown: 1-5 s inserts intercut with presenter | — | 23.5-27 | 41-55 | 55-82 |
| Close: price cards over product or hero close-up | 13-15 | 27-30 | 55-60 | 82-90 |

## Shot plan

- Presenter on camera ~40-50 % of runtime; no presenter take over ~12 s
  without an insert, punch-in or graphic.
- Inserts: product close-ups, hands-on handheld actions, screen/UI
  captures, maker renders on white, 1.5-4.6 s each, landing on the spoken
  keyword (within ~0.3 s of the word in the transcript).
- Cut rate ≥ 15/min (best ~29/min, median shot ~1.5 s).
- Axial punch-in at the emphatic sentence: split the take at the pause and
  scale 1.25-1.4 (source ≥ 1080p).
- L-cuts: the VO keeps running across the cut to inserts.

## Look & grade

- Clean, neutral commercial grade; skin and product neutral. A branded
  coloured studio backdrop (mauve, cobalt, purple) is the identity.
- Product screens hyper-saturated against deep blacks.
- `unify_grade_tool` so outdoor inserts match studio plates. No grain,
  vignette or bloom.

## Type system

- One card style for the whole video (white rounded pill, bold dark sans,
  4-5 % height, bottom-left), opening on the cut to the clip that proves it
  (graphic in-point within 3 frames of the cut). `lower_third` block
  `style: "bar"` or `add_kinetic_title_tool` `style: "documentary"`.
- Size contrast on the number that matters: price or verdict ≥ 4x the
  support text (price ~25 %, label ~5 %).
- Chapter title ~12 % heavy caps, centre. Verdict word ~22 %.
- Captions: none in 16:9; word-level captions (3-6x emphasis size) for
  9:16 delivery (`kinetic_captions_tool`).

## Motion & transitions

- `lower_third` runs at least 2.5 s: a claim shorter than that keeps its
  card into the next insert, or uses `add_kinetic_title_tool`.
- Hard cuts (~98 %). One designed transition: a chapter bumper (ring wipe
  or `ripple_logo` / `kinetic_headline` on a brand gradient) per ~60-70 s.
- No whips, no flashes, no motion-transition chains.
- Cards: a line draws out (8-10 frames), the card unfolds, text fades; or
  slides in from the left in ~10 frames.

## Sound & music

- Speech is king: VO 18-23 dB over the bed (measured 19.5-23 in the
  references); the bed is light synth-pop or lo-fi at ~108-118 bpm, even
  energy, barely audible.
- Cues on graphics, not on plain cuts: whoosh on each card entrance, a hit
  on the price or chapter card, whoosh + hit on the verdict, a click on a
  spec callout anchor. 3-10 cues per minute (reviews sit at 3-4; better
  ones add an accent on every graphic).
- Levels: voice -15 LUFS dialog-gated; music -33…-37 LUFS while speaking
  (`duck_tool`); UI cues 6-10 dB under the voice. Master -14 LUFS social,
  ≤ -1 dBTP (the references sit 8-10 LU quieter; do not copy that).

## Captions/VO

- On-camera presenter, ~145-160 wpm, nearly no air between sentences
  (speech fraction 0.93-0.95). Without footage of a presenter: a TTS VO
  (`generate_tts_and_add_to_timeline_tool`) over product inserts, cut on
  its word timings.
- Vertical: word-by-word captions with active-word highlight; 16:9: none.

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 1080, "fps": 30}
generate_tts_and_add_to_timeline_tool {"text": "<script, verdict first>", "position_seconds": 0, "track": "4"}
get_transcript_tool {"timeline_clip_id": "<voice clip>"}
gather_stock_footage_tool {"queries": ["wireless earbuds close up", "earbuds case open hand", "person running with earbuds", "phone app equalizer screen", "earbuds on table macro"], "count": 10, "orientation": "landscape", "min_seconds": 4}
```

Cut each insert on its keyword (word times from the transcript), one
`add_clip_to_timeline_tool` per claim, track 1; then a card on the same
frame:

```json
add_clip_to_timeline_tool {"file_id": "<case clip>", "position_seconds": 3.1, "start_seconds": 1, "end_seconds": 3.4, "track": "1"}
add_motion_block_tool {"block": "lower_third", "position_seconds": 3.1, "duration_seconds": 2.5, "params": {"name": "8 h battery", "role": "32 h with the case", "style": "bar", "align": "left", "palette": "light", "display_font": "sans", "accent": "#1E40FF"}}
add_kinetic_title_tool {"text": "$199", "position_seconds": 17, "duration_seconds": 2.5, "style": "stack", "animation": "pop", "text_size": 0.25, "emphasis": "$199"}
add_motion_block_tool {"block": "type_morph", "position_seconds": 21, "duration_seconds": 2.7, "params": {"words": ["BUY", "SKIP?"], "weight": 800}}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 3.1, "gain_db": -16}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": 17, "gain_db": -12}
add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 21, "gain_db": -12}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 22.2, "gain_db": -10}
search_freesound_music_tool {"query": "light lofi electronic background", "min_seconds": 35}
duck_tool {"bed": ["music"], "under": "voice", "target_vbr_db": 18}
master_audio_tool {"preset": "social", "genre": "talking_head", "iterate": true}
review_edit_tool {}
```

With a real presenter: `transcribe_media_tool` first, `split_clip_tool` at
the emphatic pause and `set_clip_properties_tool` `scale_x`/`scale_y` 1.3 on
the second half (T041). Render,
`review_render_tool`, one fix pass.

## Finish checklist

- [ ] Verdict or product + stance before 3 s.
- [ ] No presenter take over ~12 s without an insert, punch-in or graphic; ≥ 15 cuts/min.
- [ ] Every insert lands within ~0.3 s of its spoken keyword; card on the same frame.
- [ ] One card template for the whole video.
- [ ] Price or verdict ≥ 4x the support text.
- [ ] A cue on every graphic entrance; plain cuts dry.
- [ ] Voice ≥ 18 dB over the bed; delivered at -14 LUFS, ≤ -1 dBTP.
- [ ] Indoor and outdoor shots matched (`unify_grade_tool`).
- [ ] 9:16 delivery has word-level captions; 16:9 has none.

## Mix-and-match

Borrow: T047 transcript-keyed cutaway, T041 punch-in, T112 buy-or-skip,
T071 leader-line callout, T068 slide-in pills, T125 staccato keyword list,
T082 L-cut, T050 counter, T119 keyword slam. Never: T021 dark tease, T084
dead music stop, T023 one-hue stylisation, T045 strobe bursts, glitch or
whip chains, a whoosh on every cut.

## Reference moments

Local only, in `~/zenvi-motion/refs2/tech-review/`: `xbew3te` (TV review;
verdict 0-3 s, four claim inserts with pills 3.0-12.3 s, punch-in 23.3 s,
price cards 64.3 s); `xbbpn8e` (earbuds; ripple chapter bumper 10.9 s,
price pill 16.0 s, rival render cutaway 25.1 s, a 30.5 s static take that
is the weak point 36.3 s); `xbp64sa` (drone; price shout 19.8 s, leader
line callout 23.8 s, BUY/SKIP 37.3 s, inserts on adjectives 46.4 s: the
best-paced of the three).

## Example (verified 2026-10-28)

17.5 s: macOS `say` VO in six sentences (Zenvi TTS was out of credits),
Pexels earbuds inserts cut on each sentence, five bar cards, a $199 shout,
a BUY? slam (`~/zenvi-motion/fleet/artifacts/sk2-product-brand/styles/tech-review.*`). Watch judge 4.2/10: weak hook text,
a vertical phone clip letterboxed in 16:9, synthetic voice. Two cards were
refused (under 2.5 s: rule added).
