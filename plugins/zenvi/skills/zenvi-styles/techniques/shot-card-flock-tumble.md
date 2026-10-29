---
id: shot-card-flock-tumble
kind: technique
summary: "When a feature run must collapse into a slogan: cards tumble, are sucked in, a ring blows, a huge word crosses."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, movie-game-trailer, kinetic-type-motion-design]
tools: [add_3d_scene_tool, add_title_tool, add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool]
pace: fast
mood: [climactic, neon, energetic]
aspect: ["16:9", "9:16"]
pairs_with: [kinetic-keyword-slam, kcut-flood-climax, cinematic-silence-before-hit]
avoid_with: [shot-card-flip-reveal, shot-hidden-cut-masks, kinetic-quote-card]
needs: [turbulent-smoke-ring]
---

# Card flock tumble to slogan

## What it is
Three screen cards fly in edge-on, fan into a stepped stack and keep slowly turning; then they are sucked to the centre
in 10 frames, a white-hot core and one smoke ring bloom, and the brand line slams across the ring. "Many capabilities" into
"one sentence", the energy peak of a film. Sharp throughout: no blur, no depth haze.

## Build it in Zenvi
1. Cards: `add_3d_scene_tool {"scene": "card_stack", "params": {"file_ids": ["<page1>", "<page2>", "<page3>"], "count": 3,
   "kind": "card", "animation": "fan", "background": "#0b0a1a", "accent": "#a78bfa"}, "position_seconds": 0, "duration_seconds": 3, "quality": "draft"}`
   then rerender at final. (The scene tumbles and fans; the card's edge-on spline flight and constant slow turn are not
   exact. Pick `fan` and keep the last seconds in motion.)
2. The suck-in: `set_keyframes_tool` on the scene clip, `scale_x` / `scale_y` 1.0 to 0.05 over 0.33 s `ease_in_quad`, `alpha`
   held at 1 for the first 60 % then to 0, ending at 2.4 s.
3. The core flash on the same frame: `add_title_tool {"background_color": "#ffffff", "position_seconds": 2.4, "duration_seconds": 0.2,
   "fade_out_seconds": 0.2}` (a 12 % wash, at most 6 f).
4. The ring: `add_motion_block_tool {"block": "particle_burst", "params": {"shape": "rings", "count": 8, "origin": [{"x": 0.5, "y": 0.5}],
   "colors": ["#ffd1b8", "#f472b6", "#8b5cf6"], "rings": true}, "position_seconds": 2.4, "duration_seconds": 2.0, "placement": "over_video"}`
   (clean rings are what the card rejects; a turbulent smoke ring is `needs: turbulent-smoke-ring`; one ring only, no confetti).
5. The word, 4 frames after the suck-in: `add_kinetic_title_tool {"text": "ONE SENTENCE", "style": "creator", "animation": "slam",
   "text_size": 0.2, "position_seconds": 2.53, "duration_seconds": 2.0, "accent": "#f9a8d4"}`.
6. `add_sfx_tool {"recipe": "reverse_swell", "at_seconds": 2.4, "gain_db": -14}`, `{"recipe": "impact_boom", "at_seconds": 2.4}`.

## Timing & taste rules
- Flight about 44 f, settle, slow turn up to the collapse, collapse 10 f ease-in (22 f was judged too slow).
- No static frame in the high point; no blur; no sparkle confetti on the ring (it is the echo of the collapse, not a party).
- Word enters 4 f after the collapse, 14 f snap from 1.22x to 1 with tracking tightening; waiting 14 f leaves a dead black.
- Stack larger (1.6-1.74x) and heavily overlapping: it should read as one group.
- Use once, as the film's top.

## Sound for it
A reverse swell into the collapse, boom on the core (`impact_boom`), the word on a `sub_drop`; the music ducks 3 dB at the collapse.

## Common mistakes
- Hard-edged vector rings (rejected three times in the card's history).
- Letting the cards sit still before the collapse.
- Adding motion blur to the flight.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/transition/card-flock-tumble.md` (Apache-2.0; see ../NOTICE).
