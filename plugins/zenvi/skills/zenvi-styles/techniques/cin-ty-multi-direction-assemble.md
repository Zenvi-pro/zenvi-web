---
id: cin-ty-multi-direction-assemble
kind: technique
summary: "When a calm card needs a burst: each word of a short sentence flies in from a different side and locks in 36 frames."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [add_title_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [energetic, assembled]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-emphasis-scale, shot-blur-slide]
avoid_with: [cin-ty-kinetic-word-slams, kinetic-word-pop]
needs: []
drawn: cinetic
---

# Multi-direction slam assembly

cinetic `ty-multi-direction-assemble` · Typography in motion · accent · energy high · formats launch, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Each word of a short sentence flies in from a different side, oversized and streaked, and the sentence assembles on one baseline almost at once.

Use when: Re-spiking energy after a calm, read-paced card; a payoff line that needs a burst; 3-5 short words.

## Build it in Zenvi

1. One title per word at its final position on tracks 3-7: `add_title_tool {"text": "Build", "template": "Standard_1", "position_seconds": 2.0, "duration_seconds": 2.5, "track": "3"}` (and "it", "once,", "ship", "everywhere").
2. Per word i with delay d = [0, 0.067, 0.167, 0.2, 0.267] s: `set_keyframes_tool {"timeline_clip_id": "<w_i>", "property": "location_x", "ease": "ease_out_expo", "points": [{"seconds": <2.0 + d_i>, "value": <side * 0.115>}, {"seconds": <2.0 + d_i + 0.333>, "value": 0}]}` (220 px of 1920, from alternating sides; one word enters from below with `location_y` 0.185).
3. Same window on `scale_x` and `scale_y`, 1.4 to 1, and `alpha` 0 to 1 over 0.083 s.
4. Streak the flight: `apply_fx_tool {"clip_id": "<w_i>", "effects": [{"effect": "directional_blur", "amount": 0.6, "start": 0, "end": 0.15}]}`.
5. After the line completes, `scale_x/y` 1 to 0.99 over 1 s. `add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 2.0, "gain_db": -14}` and `{"recipe": "hit_transient", "at_seconds": 2.6, "gain_db": -12}`.

## Timing & taste rules

- cinetic's timing (60 fps): Per word 20 f (0.33 s) ease_out_expo, 220 px travel (62, 47, 33, 23, 16 px/f on frames 1-5), scale 1.4 -> 1, opacity 5 f (0.08 s); delays 0/4/10/12/16 f (0.27 s); each word readable from about frame 5, the whole line resolved in about 36 f (0.60 s); then 1 -> 0.99 over 60 f (1.00 s).
- Each word 20 f (0.33 s) ease_out_expo, 220 px travel, scale 1.4 to 1, opacity over 5 f (0.083 s) so it stays faint while above 20 px/f.
- Delays 0/4/10/12/16 f (0 / 0.067 / 0.167 / 0.2 / 0.267 s): a readable line from about f5, fully resolved in about 36 f (0.6 s).
- One quiet piece may fade in over 8 f instead of flying; then a 60 f (1 s) drift from 1 to 0.99.
- Only 3-5 short words; long words cross in flight.

## Sound for it

One medium whoosh at the first word and one soft hit when the line completes; never one per word.

## Common mistakes

- Right after another high-energy type move.
- Long words that would cross each other in flight.
- Calm films, where the burst is out of register.
- Avoid when: Long words that would cross each other in flight; straight after another high-energy type move; calm films.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-multi-direction-assemble`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
