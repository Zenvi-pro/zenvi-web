---
id: kids-education
kind: style
summary: "For toddler vocab, alphabet or counting: fixed-length units, the word pops after it is said, bright."
categories: [kids-education]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_kinetic_title_tool, kinetic_captions_tool, add_motion_block_tool, add_sfx_tool, generate_tts_and_add_to_timeline_tool, add_marker_tool, color_grade_clip_tool, add_transition_tool, set_track_role_tool, automate_volume_tool, master_audio_tool, review_render_tool]
pace: medium
mood: [bright, playful, warm, predictable]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [t090, t122, t056, t069, t086, t097, t024]
avoid_with: [t119, t125, t091, t115, t074]
needs: [sprite-library-overlay]
---

# Kids education

Teach one thing per unit, the same way every time: a short hook, then identical units of fixed length (one
object or letter each) where the thing is shown, said, and then its word pops in with overshoot, sparkle and a
chime, a payoff unit with everything together, and a held logo landing. High-key colour, large type, one
distinct sound on each visible event. Break the loop once in long pieces so it does not drone.

## When to use / not

- Use for: first words, fruit/colours/shapes/animals, alphabet cards, counting, simple science for under-8s.
- Not for: teen or adult education (animated-explainer, science-curiosity); anything scary for real children
  (the watched ABC piece is horror-pop aimed at adults: borrow its mechanics, not its content).

## Structure

| length | hook | units (fixed length) | payoff | logo landing hold |
| --- | --- | --- | --- | --- |
| 15 s | 0-2 s | 3 x 3.0 s (2-11 s) | 11-12 s | 12-15 s |
| 30 s | 0-2.7 s | 6 x 3.0 s or 4 x 5 s | 21-25 s | 25-30 s |
| 60 s | 0-3 s | 10 x 5 s | 53-56 s | 56-60 s |
| 90 s | 0-5 s | 16 x 5 s (one break) | 85-87 s | 87-90 s (4.4 s hold) |

Inside each unit: object shown at 0, said at about 1.0-1.5 s, word pops at 1.6-1.9 s, held about 1.1 s.

## Shot plan

One readable action or object per shot, hero on screen, camera pushes or pans on about 60% of shots; song
montages cut every ~2 s on audio onsets (90% onset, not the beat). Hands presenting objects work well.

## Look & grade

High key: luma about 135-140 of 255, saturated (sat 100-130); warm and clean. One texture (paper, t024) over
mixed art styles. Each unit may own a palette colour; the type style stays the same.

## Type system

One bubbly or condensed display face for the hero word (creator style emphasis face), big: at least 7% of
height on 9:16 (letter cards 45-70%). One word on screen at a time; colour per unit from a fixed set.

## Motion & transitions

Pops with overshoot (0 to 115% in 4 frames, settle in 3), small idle wiggle, hard-cut exits. Hard cuts
everywhere except one 12-frame dissolve for a place change (t097). Spring landing for the logo (t069).

## Sound & music

- Music: ukulele, glockenspiel or happy acoustic, steady; lower under the spoken word.
- Levels: voice clearly forward (the vocab clip measures VO about 23 dB over the bed; aim 12+), master -14 LUFS,
  true peak at or below -1 dBTP (the ABC piece clips at +2.1: never).
- Cues: one per event and distinct per unit (pop + sparkle on each word, a splat or boom per gag, a hit on the
  logo landing); about 1.2 cues per cut.

## Captions/VO

A warm adult or child voice naming the object, one word or very short phrase; no running captions (the pop
word is the caption). Optional echo: the word said again as it pops.

## Tool sequence

1. Hook card: `add_kinetic_title_tool` `{"text": "What's on the table?", "style": "creator", "animation": "pop",
   "emphasis": ["table?"], "accent": "#ffcc00", "background": "#5ec8f2", "duration_seconds": 2}` + `pop`.
2. Units (t090): `add_clip_to_timeline_tool` at `2.0 + i * L` with exactly `L` seconds of source;
   `set_keyframes_tool` scale 1.0 to 1.06 over the unit; `add_marker_tool` per unit.
3. Spoken word per unit at +1.0 s: one `generate_tts_and_add_to_timeline_tool` per word (`voice: "shimmer"`) or
   the recording, on its own track; `set_track_role_tool` voice.
4. Word pop (t122) at +1.6 s: `add_kinetic_title_tool` `{"text": "GRAPES", "style": "creator", "animation": "pop",
   "emphasis": ["GRAPES"], "accent": <unit colour>, "y": 0.62, "duration_seconds": 1.4}`;
   `add_motion_block_tool` `particle_burst` `{"shape": "confetti", "origin": [{"x": 0.5, "y": 0.62}], "count": 50,
   "seed": <i>}`; `add_sfx_tool` `pop` + `sparkle` (-16, seed per unit).
5. Landing (t069): `add_motion_block_tool` `{"block": "logo_reveal_end", "placement": "full_frame",
   "duration_seconds": 3.5, "params": {"brand": "...", "cta": "One new word a day", "url": "", "palette": "sky"}}`
   + `impact_punch` on the settle + `sparkle`.
6. Music bed -18 dB, `automate_volume_tool` `fade_out` at the end.
7. `master_audio_tool` `{"preset": "social", "iterate": true}`, render, `review_render_tool`.

## Finish checklist

1. Every unit is the same length to the frame.
2. The word card follows the spoken word by about 3 frames and holds 1.0-1.1 s.
3. Each event has its own cue; not one generic whoosh on every cut.
4. The hero element is large: words 7%+ of height on 9:16, letters 45-70%.
5. One texture or art style unifies the units.
6. Music-led montages cut on audio onsets.
7. High key: no dark grade.
8. True peak at or below -1 dBTP, about -14 LUFS, voice well over the bed.
9. One readable action per shot, the hero on screen.
10. The loop is broken once in pieces longer than about 60 s.

## Mix-and-match

- Borrow: t090, t122, t056 (letter gags), t069 (landing), t086 (cues), t097 (one dissolve), t024 (paper).
- Never: slam cards (t119), staccato lists (t125), documentary cold opens (t091, t115) or drop montages (t074).

## Reference moments

Local only (`~/zenvi-motion/refs2/kids-education/`): `DdGw0YSqwGn@1.9` word pop after the spoken noun (9:16),
`DdGw0YSqwGn@8.8` payoff with all three objects, `ABCMonsters@10` 5.0 s letter loop, `ABCMonsters@20.9` gag inside
a static letter, `NatureCat-OceanCommotion@2.7` action-per-shot song montage, `@41.5` hero-to-logo landing,
`@50.8` the one dissolve.

## Verified

VERIFIED-PENDING
