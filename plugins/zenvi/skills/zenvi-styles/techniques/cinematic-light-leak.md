---
id: cinematic-light-leak
kind: technique
summary: When two warm shots should melt together or a memory should glow - a film burn into a white flash, or a drifting leak.
categories: [wedding-event-film, travel-cinematic-montage, music-lyric-video, brand-story-corporate, fashion-beauty-ad]
tools: [apply_fx_tool, split_clip_tool, apply_motion_transition_tool, add_sfx_tool]
pace: medium
mood: [warm, dreamy, nostalgic, euphoric]
aspect: ["16:9", "9:16", "4:3", "2.39:1"]
pairs_with: [cinematic-warm-nostalgia, cinematic-film-emulation, cinematic-halation-bloom, cinematic-montage-rhythm]
avoid_with: [cinematic-cold-thriller, cinematic-day-for-night, cinematic-bleach-bypass]
needs: [lens-flare-element]
---

# Light leak and film burn

## What it is

Light spilling onto the film: a warm leak drifting in from an edge, or a burn that flares to white
at the end of a roll. As a transition it is the softest join there is; as a texture it says
"memory". Shines in weddings, summer travel, music videos, warm brand stories.

Related shot cards: `shot-transition-hidden-cut` (cut hidden in a warm light peak, an occluder or a slam), `shot-white-flash-logo-simplify-cut`, `shot-light-play-moves`.

## Build it in Zenvi

Burn as a transition (only on the tail of the outgoing shot):
1. `split_clip_tool` `{"clip_id": "<outgoing>", "at_seconds": <cut - 0.6>}` - isolates the last 0.6 s.
2. `apply_fx_tool` `{"clip_id": "<tail>", "effects": [{"effect": "light_leak", "amount": 0.8,
   "params": {"style": "burn", "color": "#ff8a2a", "seed": 7}}]}`.
3. `apply_motion_transition_tool` `{"preset": "flash_white", "clip1_id": "<tail>", "duration": 0.25,
   "intensity": 0.6}`.
4. `add_sfx_tool` `{"recipe": "swish_airy", "at_seconds": <cut>, "gain_db": -16}`.
Leak as texture on a whole shot: `apply_fx_tool` `{"clip_id", "effects": [{"effect": "light_leak", "amount": 0.35-0.45,
"params": {"style": "leak", "color": "#ffb36b"}}]}`. A real anamorphic/spherical lens-flare element tracked to a light source is
missing (`lens-flare-element`).

## Timing & taste rules

- Burn on the whole clip (amount 0.7) turns a sunset into a yellow blob - split first.
- Leaks: amount 0.3-0.5, one every 6-10 s; vary `seed` so no two are the same.
- Use it on warm shots and on cuts between similar warmth; a burn into a cold night shot breaks.
- Put the flash on a beat or a lyric, otherwise it reads as unmotivated.
- White flash: start at 95 % opacity and fall to 0 over 4 frames ease-out; longer than 6 frames it turns into a soft dissolve and loses the shutter snap. Put the hard cut inside the 1-3 brightest frames (video-shotcraft, Apache-2.0, `shot-beat-cut-moves`, `shot-transition-hidden-cut`).
- Give a flash a wind-up: 0.4 s of brightening (about 1.7x) before it, or it reads as a dropped frame (`shot-white-flash-logo-simplify-cut`).

## Sound for it

`swish_airy` or a soft `reverse_swell` into the flash; no impact.

## Common mistakes

- Leak + bloom + flash on one shot (white-out).
- The same leak seed on every shot (the pattern repeats visibly).

## Verified

2026-10-28, `tech/light-leak` (sunset over the sea -> a mountain road at dusk, 6 s 720p24). Pass 1
(burn on the whole first clip, amount 0.7): the sun became a yellow blob. Pass 2 (split, burn the last
0.6 s, white flash, swish): judge transitions 5/10, overall 4.4, "the warm light leak transition
connects the golden hour sunset to the aerial mountain road well tonally"; it wanted the flash on a
musical accent (last rule).
