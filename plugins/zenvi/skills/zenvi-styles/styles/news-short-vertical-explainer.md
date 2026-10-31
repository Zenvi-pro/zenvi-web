---
id: news-short-vertical-explainer
kind: style
summary: "For a vertical news or explainer short: thesis on a card in 2 s, a picture per clause, a hero number."
categories: [news-short-vertical-explainer]
tools: [gather_stock_footage_tool, generate_tts_and_add_to_timeline_tool, get_transcript_tool, add_clip_to_timeline_tool, set_clip_audio_video_tool, set_keyframes_tool, add_kinetic_title_tool, kinetic_captions_tool, add_motion_block_tool, add_title_tool, add_sfx_tool, set_track_role_tool, automate_volume_tool, master_audio_tool, review_render_tool]
pace: fast
mood: [urgent, clear, credible]
aspect: ["9:16"]
pairs_with: [t060, t011, t041, t051, t052, t070, t119, t125]
avoid_with: [t092, t115, t091, t122]
needs: [news-source-card, geo-map-render]
---

# News short / vertical explainer

A phone-first explainer: the thesis named in plain words on a card within 2 s (muted viewers read it), a
concrete picture for every clause (cut about every 0.8-1.5 s), one hero number snap-popped on its spoken
figure, a third-party proof card when there is a source, an energy build to a peak around 58% and a statement
card or question at the end. 1-2 word synced captions with a slam 2.5-3.5x their size; a cue on every text
entrance; -14 LUFS.

## When to use / not

- Use for: news explainers, "how does X work" in 30-60 s, business and science shorts, faceless stock-footage
  explainers, interview clips with name lower thirds.
- Not for: long-form documentary, slow nature pieces, kids content.
- Facts must come from the user or a cited source; never invent numbers, outlets or quotes.

## Structure

| length | hook card | setup (what is it) | proof beats | claim / number | close |
| --- | --- | --- | --- | --- | --- |
| 15 s | 0-2 s | 2-5 s | 5-10 s | 10-13 s | 13-15 s |
| 30 s | 0-2.5 s | 2.5-7 s | 7-17 s (2-3 beats) | 17-25 s (peak about 58%) | 25-30 s |
| 60 s | 0-4 s | 4-15 s | 15-36 s (3 beats) | 39-54 s | 54-60 s |
| 90 s | 0-4 s | 4-20 s | 20-55 s | 58-80 s | 80-90 s |

Interview variant: hook card 0-3.7 s over the speaker, then the name lower third on the same frame as the first
punch-in (t060 + t041); speakers 2-19 s each.

## Shot plan

Vertical-native footage (portrait stock or 9:16 crops); one visual idea per clause, literal (the noun on
screen, t011); a real artefact (document, outlet card, sample) about every 15 s; no 6-12 s holds on a generic
plate; median shot under 1.5 s outside interviews.

## Look & grade

Portrait footage only, or landscape clips filled with `set_clip_property_tool` `scale` 0; never letterboxed.

Clean and contrasty; one accent colour for numbers and slams (cyan, red or gold); dark plates under type; no
permanent channel bug or source credit in two corners (one small mark at most).

## Type system

- Hook: creator style, 3-6 words, upper third (`y` about 0.22), emphasis word in the accent.
- Captions: 1-2 word synced uppercase-feel captions about 4% (`kinetic_captions_tool` `style: "creator"`),
  kept out of the bottom UI band.
- Slam / hero number: 2.5-3.5x the caption size (`text_size` 0.2+), one per piece; counters for figures.

## Motion & transitions

Hard cuts on the clause, a short whoosh on each; pushes 5-6% on every plate (nothing static); pops with
overshoot on cards; one slam with a sub hit and 0.5 s of shake at the claim. No dissolves.

## Sound & music

- Music: corporate pulse, lo-fi or tense electronic, building toward the claim (energy peak about 58%) and
  dipping under the slam.
- Levels: voice -15 LUFS, music 8-12 dB under, master -14 LUFS (between -16 and -13), -1 dBTP.
- Cues: about 12 per minute: pop on the hook, whoosh per cut, riser + sub drop + slam on the number, a soft hit
  on the end card.

## Captions/VO

Fast, clear VO at 165-185 wpm, almost wall-to-wall; first word on frame 1. One TTS line per clause (`voice:
"onyx"` or `"alloy"`) so cuts land on line starts.

## Tool sequence

1. VO per clause: `generate_tts_and_add_to_timeline_tool` back to back (`speed: 1.1`), `set_track_role_tool` voice.
2. Footage: `gather_stock_footage_tool` `{"queries": ["<one per clause noun>"], "orientation": "portrait", "count": 10}`.
3. Picture per clause: `add_clip_to_timeline_tool` with `position_seconds` = clause start, length = clause;
   `set_keyframes_tool` scale 1.0 to 1.06 per shot; `set_clip_audio_video_tool` `{"audio": "off"}`.
4. Hook (t060): `add_kinetic_title_tool` `{"text": "800,000-year-old air", "style": "creator", "animation": "pop",
   "emphasis": ["800,000-year-old"], "accent": "#5cd2ff", "y": 0.22, "position_seconds": 0,
   "duration_seconds": <first clause>}` + `pop`.
5. Captions: `kinetic_captions_tool` `{"cues": [...], "style": "creator"}` (leave out the hook line and the slam word).
6. Hero number: `add_motion_block_tool` `{"block": "counter", "placement": "full_frame", "track": "1",
   "params": {"values": ["280", "420"], "suffix": " ppm", "label": "CO2 in the air", "palette": "night",
   "accent": "#ff5a36"}}` + slam (t119) `add_kinetic_title_tool` `{"text": "420", "style": "stack",
   "animation": "slam", "accent": "#ff5a36", "text_size": 0.22, "y": 0.75}` + `riser_tonal`, `sub_drop`,
   `impact_slam` (-10) + `automate_volume_tool` `dip` -10 dB under it.
7. Source card if there is one (t051), map markers for places (t070), chart for a trend (t052).
8. Close on a statement shot 1.5-2 s; music `fade_out` 1.2 s.
9. `master_audio_tool` `{"preset": "social", "genre": "talking_head", "iterate": true}`, render, `review_render_tool`.

## Finish checklist

1. Median shot under 1.5 s on non-interview sections.
2. The picture changes at every clause; no 6-12 s generic holds.
3. 1-2 word synced captions plus a slam 2.5-3.5x the caption size.
4. One cue per title, card and stat entrance; integrated -16 to -13 LUFS.
5. At least half of the cuts carry a cue (`spot_sound_tool`).
6. A real artefact (document, source card, sample) about every 15 s.
7. Energy rises toward the claim (peak about 58%) and ends on a statement card or line, not a fade-out.
8. The thesis is named within 2.2 s in plain words.
9. No persistent overlay except one small mark.
10. One typeface family and one accent colour throughout.

## Mix-and-match

- Borrow: t060 (hook), t011 (literal inserts), t041 (punch-ins on interviews), t051 (source card), t052 (chart),
  t070 (markers), t119 (slam), t125 (list).
- Never: calm held labels (t092), documentary resets and cold opens (t115, t091), kids pop cards (t122).

## Reference moments

Local only (`~/zenvi-motion/refs2/news-short-vertical-explainer/`): `x9q350k@4.8` hero-number lockup,
`x9q350k@19.3` literal inserts per claim, `x9q350k@40` third-party source card, `x9vnh9i@0` hook card handing to
a lower third, `x9vnh9i@3.7` punch-in jump cut, `xa4epve@6.8` staggered map markers, `xa4epve@13.5` layered
diagram labels (Gemini clock about 1.5x). Owner reel in the dossier: `DdB8LATJ_1z@2.2` caption-to-slam escalation.

## Verified

2026-10-28. Example edit (17 s): `~/zenvi-motion/fleet/artifacts/sk1-knowledge/styles/news-short-vertical-explainer/example.mp4` (contact sheet and `calls.json` next to it), built with
`zenvi call` on the portable CLI from Pexels stock and a macOS `say` voice (`scripts/` in the same folder).
Watch judge (absolute, gemini-3.8-flash): 4.27/10 overall; its first note: "Hockey rink footage feels completely disconnected from Antarctic ice drilling." (at 4.8 s).
Pairwise against the category's reference segment (same length): winner cand (passes ['cand', 'cand']) cand 5.36 vs other 3.86 $0.0087.
