---
id: shot-aurora-flip
kind: technique
summary: "When the story turns: a soft light aurora ground drops to near-black in 0.36 s on one low hit, then a new line lands."
categories: [video-essay-explainer, brand-story-corporate, product-launch-film, documentary-true-story, saas-app-launch]
tools: [add_motion_block_tool, add_title_tool, add_kinetic_title_tool, add_sfx_tool]
pace: calm
mood: [turning-point, dramatic, modern]
aspect: ["16:9", "9:16"]
pairs_with: [kinetic-mask-reveal, kinetic-title-sequence, cinematic-silence-before-hit, t119]
avoid_with: [shot-glow-flyline, shot-brand-frame-snap, kcut-flood-climax]
needs: []
---

# Aurora bloom, then the ground flips to black

## What it is
The "for years... then everything changed" beat. A light ground slowly lifts a purple-and-orange soft-focus bloom for over half the shot,
the viewer settles; then in under 0.4 s the whole ground drops to near-black, the bloom dims to an afterglow, and the old line is replaced
(blur out, a gap, blur/rise in) by the new one. The darkening, not a zoom or a white flash, is the accent.

## Build it in Zenvi
```json
add_motion_block_tool {"block":"gradient_field","position_seconds":0,"duration_seconds":4.8,"placement":"over_video",
  "params":{"style":"aurora","colors":["#6b4fe0","#d97a4a","#ffffff"],"speed":0.8,"grain":true}}
add_title_tool {"template":"Solid_Color","text":" ","background_color":"#0a0a12ed","position_seconds":2.9,"duration_seconds":1.9,"fade_in_seconds":0.36}
add_kinetic_title_tool {"text":"Once, a week of work","style":"editorial","animation":"fade","emphasis":"none","text_size":0.16,"ink":"#1a1a24","y":0.5,"position_seconds":0.9,"duration_seconds":1.9}
add_kinetic_title_tool {"text":"now one afternoon","style":"editorial","animation":"rise","emphasis":"afternoon","text_size":0.16,"stagger_seconds":0.08,"accent":"#c9b8ff","ink":"#ffffff","y":0.5,"position_seconds":3.6,"duration_seconds":1.2}
add_sfx_tool {"recipe":"sub_drop","at_seconds":2.95,"gain_db":-14}
add_sfx_tool {"recipe":"whoosh_rise","at_seconds":2.9,"gain_db":-18}
```
The dark card is near-black (`#0a0a12`), not pure black: pure black shows colour banding at the bloom's edge. Alpha `ed` (93 %) leaves the aurora as an ember. Old line leaves before the flip; the new line starts after a ~0.6 s gap with no text on screen (no crossfade).
Not available: per-word blur out / blur in on the lines (use the `fade` / `rise` animations), true per-frame tint of the field itself.

## Timing & taste rules
- Total ~5.2 s (156 f). Bloom rises over the first 56 % (the longer the wait, the heavier the flip). The flip itself 0.36 s (t 0.57-0.64, `inOutQuad`); at 1 s it becomes a gradient transition, not an accent.
- Bloom blobs: 3 layers, 60 px blur, main 90 % x 85 %, orange core drifts +-8 %; blur below 40 px reads as coloured balls.
- Old line: words leave with stagger 0.04 s, 0.10 s each, accelerating (`inQuad`: "eaten by the light"); new line: stagger 0.05 s, 0.11 s each, settling `outQuint`, accent colour to white 0.09 later, still for the last ~0.5 s.
- The flip colour is the effect's own light colour (violet / orange), not a brand slot: change all blobs and the new line's accent together.
- Type must be big enough for 720p (text_size 0.16 or more).

## Sound for it
`sub_drop` (-14 dB) on the first frame of the darkening, a quiet `whoosh_rise` (-18 dB) into it. Nothing on the new line.

## Common mistakes
- Fading the dark card over > 0.5 s: becomes a dissolve.
- Cross-fading the two lines: the gap is what reads as turning a page.
- The white melt layer must leave with the flip, or it leaves grey fog on the dark ground (this block's own light ground handles it).

## Verified
2026-10-29, CLI on generated media (no footage): scripts/shot-aurora-flip.sh → shots/shot-aurora-flip.mp4 (local only). Checked on the sheet: purple/orange aurora on a light ground with the first line settling, then a dissolve to near-black and the second line (accent word italic) after a gap; the first version had the text too small and a blue bar from the wrong title template. Watch judge (absolute): **6.8/10**; main note: "The first text entrance is static and plain, lacking the motion polish seen in modern kinetic typography."

Adapted from video-shotcraft card `shots/effects/aurora-bloom-bg-flip.md` (Apache-2.0; see ../NOTICE).
