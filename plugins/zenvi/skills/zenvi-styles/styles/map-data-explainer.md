---
id: map-data-explainer
kind: style
summary: "For data, places or change over time: set the axes, play the data, anchor it in footage, one clock."
categories: [map-data-explainer]
tools: [gather_stock_footage_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_vignette_tool, add_motion_block_tool, add_title_tool, add_captions_tool, add_transition_tool, generate_tts_and_add_to_timeline_tool, add_sfx_tool, set_track_role_tool, set_audio_gain_tool, duck_tool, automate_volume_tool, master_audio_tool, review_render_tool]
pace: medium
mood: [authoritative, curious, sober]
aspect: ["16:9", "9:16"]
pairs_with: [t055, t052, t070, t043, t054, t129, t065, t007]
avoid_with: [t122, t056, t125, t074]
needs: [geo-map-render, pictogram-chart-morph, data-clock-hud, globe-data-trace-render]
---

# Map / data explainer

A data story: frame the old picture, name the unit and the axes before anything moves, play the data while the
narration tracks it, pull in a human anchor (footage of the thing counted) and come back, then a payoff or a
challenge. One unit persists across chart and footage; one clock; one accent colour on the counted thing.
Zenvi can assemble, time, label, mix and finish this category; it cannot yet render real maps, pictogram charts
or flow fields (see `needs`), so maps come from supplied images or stock and charts from `chart_build`.

## When to use / not

- Use for: "how X changed since 1950", where something happens, comparisons between places, any explainer
  whose proof is a number.
- Not for: opinion essays without data (video-essay), kids content, hype edits. If the core asset is a real map
  render the user does not have, say so and fall back to stock maps plus markers.

## Structure

| length | old picture / hook | set the axes / unit | play the data | human anchor | payoff or challenge |
| --- | --- | --- | --- | --- | --- |
| 15 s | 0-3 s | 3-5 s | 5-11 s | - | 11-15 s |
| 30 s | 0-5 s | 5-9 s | 9-18 s | 18-23 s | 23-30 s |
| 60 s | 0-10 s | 10-18 s | 18-36 s | 36-45 s | 45-60 s |
| 90 s | 0-15 s | 15-25 s | 25-55 s (two plays) | 55-70 s | 70-90 s (rewind / compare) |

Talk-led variant: the presenter wide holds long (p90 12-18 s) and the edit cuts to full-frame captures (t043).
Single-take variant: one 30-60 s globe or map take with only a clock (t007).

## Shot plan

Charts and maps full frame when they must be read (never read axes from a wide); footage inserts 2-8 s that show
the unit (people, factories, ice); every camera move ends on a labelled thing (push to a number, pull out to the
aggregate, pan to compare).

## Look & grade

Neutral ground (near-black `night` or white), saturation low on everything except ONE accent that marks the
counted thing (red, orange). Vignette on footage under labels. Chart palette = piece palette.

## Type system

Labels 3-8% of height, caps or condensed, mono for numbers and clocks; they build with their bracket or marker,
never just appear. Subtitles small (3.5%) at the bottom, sentence-level. Exactly one clock element, stepped (t055).

## Motion & transitions

Hard cuts on gestures or animation starts, 0.5-1 s dissolves between chart and footage (t054), one designed
chapter wipe at most. Eased pushes (15-25%) on maps; markers pop 0.2 s apart (t070); charts draw 2-3 s (t052).

## Sound & music

- Music: ambient pulse or minimal electronic, steady, low.
- Levels: voice -15 LUFS, bed at least 10-12 dB under the voice in speech windows (the best clip was too loud
  at 0 dB; 10-12 dB is the target), master -14 LUFS (or -16 for long-form).
- Cues tied to data events: whoosh on every motion transition, click per marker or block split, riser + hit on
  the chart's end state; dissolves may stay silent. About 6-12 per minute.

## Captions/VO

Produced narration about 105 wpm with gaps of 1+ s while a chart builds; play-by-play sections at 145 wpm (t129).
Sentence subtitles (`add_captions_tool` `style: "classic"`) rather than word pops.

## Tool sequence

1. VO per line (`generate_tts_and_add_to_timeline_tool`, or the user's read), `set_track_role_tool` voice.
2. Plates: `gather_stock_footage_tool` `{"queries": ["globe rotating", "world map", "<the unit> footage"]}`;
   place with `add_clip_to_timeline_tool`; `set_keyframes_tool` scale 1.0 to 1.08-1.2 pushes; `add_vignette_tool`
   `{"amount": 0.45}`.
3. Clock: `add_motion_block_tool` `{"block": "counter", "params": {"values": ["1957","1980","2004"],
   "style": "count", "label": "...", "align": "left", "display_font": "mono"}}`.
4. Places: `add_motion_block_tool` `{"block": "hud_callouts", "params": {"title": "ICE CORE SITES", "labels": [...],
   "values": [...], "grid": "none", "points": [{"x":..,"y":..}, ...]}}` + `add_sfx_tool` `ui_tap` per marker
   (0.2 s apart).
5. The data: `add_motion_block_tool` `{"block": "chart_build", "placement": "full_frame", "track": "1",
   "params": {"kind": "line", "title": "CO2 in air bubbles, ppm", "values": [...], "labels": [...],
   "palette": "night", "accent": "#ff5a36", "exit": false}}` (`exit: false` when it holds to a cut; its exit
   fade reads as a grey flash before footage).
6. Unit continuity into footage: `add_transition_tool` `common/fade` 0.8 s + held icons (t054).
7. Subtitles: `add_captions_tool` `{"cues": [...], "style": "classic", "text_size": 0.035, "background_opacity": 0}`.
8. Sound: `add_sfx_tool` `whoosh_medium` on motion joins, `riser_tonal` + `impact_punch` on the payoff value;
   music bed -20 dB; `duck_tool` `{"under": "voice", "target_vbr_db": 12}`.
9. `master_audio_tool` `{"preset": "social", "iterate": true}`, render, `review_render_tool`.

## Finish checklist

1. One graphic element (unit, icon, colour) appears in two consecutive shots: chart to footage continuity.
2. Every motion transition and block split has a cue; dissolves may stay silent.
3. One hue carries the counted thing; everything else neutral.
4. A full-frame view within a few seconds of any chart state change; no axis read from a wide.
5. Labels at least 3% of height, built with their marker or bracket.
6. Exactly one clock on screen, fixed spot, stepped digits.
7. Talk edits: p90/median shot length at least 2.5.
8. Every camera move ends on a labelled thing.
9. VO gaps of 1+ s while a chart builds.
10. `analyze_mix_tool`: bed at least 10 dB under the voice in speech windows.

## Mix-and-match

- Borrow: t055 (clock), t052 (chart draw), t070 (markers), t043 (presenter-to-capture), t054 (unit morph),
  t129 (play-by-play), t065 (definition slide), t007 (globe take).
- Never: kids pop cards (t122, t056), staccato slam lists (t125) or drop-locked montage (t074): they turn
  measurement into hype.

## Reference moments

Local only (`~/zenvi-motion/refs2/map-data-explainer/`): `128373915@4.8` unit icons into archive footage (the
best clip), `128373915@40.5` aggregate collapse, `128373915@46.5` 3D flag chapter wipe, `140@34.2` stage-to-
capture cut, `140@35` play-by-play, `620@11.8` progressive definition slide, `co2_year_11719@0` date badge and
HUD band, `perpetual_ocean_3827@0` single globe take. Gemini clocks for 140/620/128373915 run about 1.5x long:
use them as order, not seconds.

## Verified

2026-10-28. Example edit (19 s): `~/zenvi-motion/fleet/artifacts/sk1-knowledge/styles/map-data-explainer/example.mp4` (contact sheet and `calls.json` next to it), built with
`zenvi call` on the portable CLI from Pexels stock and a macOS `say` voice (`scripts/` in the same folder).
Watch judge (absolute, gemini-3.8-flash): 5.18/10 overall; its first note: "Video ends abruptly on a static chart without a proper resolving visual or outro." (at 16.5 s).
Pairwise against the category's reference segment (same length): winner tie (passes ['other', 'cand']) cand 5.18 vs other 5.09 $0.0102.
