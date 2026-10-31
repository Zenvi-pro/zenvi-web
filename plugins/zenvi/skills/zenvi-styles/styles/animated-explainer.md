---
id: animated-explainer
kind: style
summary: "For explaining a concept in motion graphics: one idea per 3-9 s beat, morphs not cuts, a sound per event."
categories: [animated-explainer]
tools: [list_motion_blocks_tool, add_motion_block_tool, apply_motion_transition_tool, generate_tts_and_add_to_timeline_tool, kinetic_captions_tool, add_kinetic_title_tool, add_emoji_tool, set_keyframes_tool, add_sfx_tool, auto_sound_design_tool, spot_sound_tool, set_track_role_tool, automate_volume_tool, master_audio_tool, review_render_tool]
pace: medium
mood: [clear, playful, clever]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [t101, t064, t113, t086, t119, t099, t014, t092]
avoid_with: [t042, t091, t124, t082]
needs: [svg-icon-morph-chain, motion-block-word-cues]
---

# Animated explainer

A concept explained in moving graphics: a one-line hook while the first graphic is already moving, then a
chain of concept beats of similar length where each scene transforms out of the previous one, a deliberate
reset with a change of texture and a music drop, the biggest statement as payoff, and a held end state with a
sound. Every graphic event has a sound; captions dodge the graphics; the keyword is 2-4x the caption.

## When to use / not

- Use for: how something works (money, science, software, a process), a framework or list of ideas, a brand
  explainer, any topic with no footage.
- Not for: stories about real people (documentary), footage-led arguments (video-essay), calm nature pieces
  (use t092 inside science-curiosity), anything that needs real maps or data renders (map-data-explainer).

## Structure

| length | hook | concept beats | reset | payoff | close (held) |
| --- | --- | --- | --- | --- | --- |
| 15 s | 0-2 s | 2 x 4 s | - | 10-13 s | 13-15 s |
| 30 s | 0-3 s | 3-4 x 5 s | 18-20 s | 20-27 s | 27-30 s |
| 60 s | 0-3.5 s | 7-8 x 5.8 s | 20-40 s (one) | 45-55 s | 55-60 s (CTA 10%) |
| 90 s | 0-4 s | 10-12 x 6 s | 30-60 s (one) | 70-84 s | 84-90 s |

One concept per beat (median 5.8 s, range 3.3-8.9 s); nothing unchanged for more than 8 s except the reset or
a quote card.

## Shot plan

Scenes, not shots: background field + one hero graphic (shape, counter, chart, icon row) + captions. Each new
idea brings one new visual element; scenes join by morph, zoom-through, push or match (hard cuts under 20%
of joins). For a quote, a held parchment card with typing (t120).

## Look & grade

One palette for the whole piece (pick one motion-block `palette`: `night`, `cream`, `sky`, ...) and one texture
(grain, paper or a 12 fps boil feel), with at most one deliberate break at the reset (e.g. monochrome).
Accent colour only on the thing being explained (the number, the keyword).

## Type system

- Captions: 2-5 word phrases around 3% of frame height, changing about every 0.8 s, in the band the graphic
  leaves free (t113: `kinetic_captions_tool` `style: "documentary"` with `y` or `avoid`).
- Keyword: 7-12% height in the accent with an overshoot (`add_kinetic_title_tool` `animation: "pop"`).
- Numbers: `counter` block, never a static title; do not also pop the same number as a keyword title (it
  collides with the counter's digits).

## Motion & transitions

Everything eased (fast in, long settle), overshoot on pops (105-115%), staggered entrances. Joins:
`zoom_through` at section changes, `blur_dissolve` or morph inside a section, one graphic wipe (t099) or glitch
at most per section. No linear moves.

## Sound & music

- Music: light lo-fi, ambient electronic or playful percussion, 85-110 bpm; drops out at the reset.
- Levels: voice -15 LUFS, music 8-12 dB under (reels measured 5.7-13.7 dB, median 7.3), master -14 LUFS.
- Cues: 24-36 per minute, about 80% under the voice: pop/click per icon or word, whoosh per move, hit when an
  object settles, riser into the payoff, stinger on the logo (t086).

## Captions/VO

Friendly, clear VO at 150-170 wpm with small pauses where the graphic lands. Each line names what the screen
shows at that moment. One TTS call per line gives exact cue times for captions and pop-ins.

## Tool sequence

1. VO per line: `generate_tts_and_add_to_timeline_tool` (`voice: "nova"`, `position_seconds` back to back);
   `set_track_role_tool` voice. Keep each line's start/end as cues.
2. Background for the whole piece: `add_motion_block_tool` `{"block": "gradient_field", "placement": "full_frame",
   "track": "1", "duration_seconds": <total>, "params": {"palette": "night"}}`.
3. Beat graphics over it, one per line, each starting on its line: `shape_morph` (hook:
   `{"shapes": ["circle", "ring", "plus"], "style": "outline", "size": 0.5}`), `counter`
   (`{"values": ["1", "2.59", "17.45"], "prefix": "$", "decimals": 2, "label": "..."}`), `chart_build`
   (`placement: "over_video"`, `{"kind": "bar", ..., "caption": "17x"}`), `type_morph`, `hud_callouts`.
4. Joins between full-frame scenes: `apply_motion_transition_tool` `{"preset": "zoom_through", "time": <join>}`.
5. Pop-ins on spoken nouns (t064): `add_emoji_tool` + `set_keyframes_tool` `ease_out_back` scale 0 to 1 in 0.2 s.
6. Captions in the free band: `kinetic_captions_tool` `{"cues": [...], "style": "documentary", "y": 0.9}`; the
   keyword (only when no counter already shows it, or it collides with the digits): `add_kinetic_title_tool`
   `{"text": "growth", "style": "creator", "animation": "pop", "accent": "#ffd23f", "text_size": 0.06}`.
7. Sound: `auto_sound_design_tool` `{"genre": "saas_ui", "intensity": "normal"}` or `add_sfx_tool` per event
   (`pop` -16, `whoosh_short` -14 on moves, `impact_punch` -10 on the number, `riser_tonal` into the payoff,
   `sparkle` on the end); check with `spot_sound_tool`.
8. Music bed -20 dB, `automate_volume_tool` `dip` -6 to -10 dB for 2 s at the reset and `fade_out` at the end.
9. `master_audio_tool` `{"preset": "social", "iterate": true}`, render, `review_render_tool`.

## Finish checklist

1. Every graphic event has a sound (cue count at events / events near 1; 24-36 cues per minute).
2. Under 20% of joins are hard cuts.
3. No graphic unchanged for more than 8 s (except the reset or a quote).
4. Captions never overlap the active graphic; phrases of 2-5 words.
5. Keyword height at least 2x the caption height.
6. One palette and one texture, at most one deliberate break.
7. Music 6-14 dB under the voice; master about -14 LUFS.
8. The end state holds at least 1 s with an audio button within 0.3 s of the last visual change.
9. All motion eased; a texture layer exists.
10. One reset with the music down 6+ dB for 2 s or more, at 1/3-2/3 of the runtime.

## Mix-and-match

- Borrow: t101 (morph joins), t064 (icons on words), t113 (captions that dodge), t086 (cue per event), t119
  (keyword slam), t099 (section wipe), t014 (scale ladder), t120 (typed quote card).
- Never: observational grammar (t042, t091, t124) or archival L-cuts (t082) in the same piece; they need real
  footage and slow it to documentary pace.

## Reference moments

Local only (`~/zenvi-motion/refs2/animated-explainer/`): `isforAto1953` (scale ladder, pincushion to atoms,
order only), `261819172@0.8` held-label calm pacing (the calm variant). Owner reels in the dossier:
`CrCIu_mo-y0@1.4` morph chain, `CrCIu_mo-y0@13.5` four icon clicks, `Deiz38JJvmv@5.2` keyword slam,
`Deiz38JJvmv@14.9` pixel-mosaic section wipe, `DbqvQrPTPIS@19.8` typewriter quote card.

## Verified

2026-10-28. Example edit (14 s): `~/zenvi-motion/fleet/artifacts/sk1-knowledge/styles/animated-explainer/example.mp4` (contact sheet and `calls.json` next to it), built with
`zenvi call` on the portable CLI from Pexels stock and a macOS `say` voice (`scripts/` in the same folder).
Watch judge (absolute, gemini-3.8-flash): 5.36/10 overall; its first note: "The abstract intro shape animations feel disconnected from the topic of money." (at 1.5 s).
Pairwise against the category's reference segment (same length): winner cand (passes ['cand', 'cand']) cand 6.0 vs other 3.59 $0.0085.
