---
id: cin-mi-anticipation-dip-unlock
kind: technique
summary: "When something locked becomes available, light builds, the card dips dark as the lock opens, then pops to clean."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_effect_tool, update_effect_tool, list_effects_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [payoff, tactile, release]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-pre-event-tell, cin-mi-spinner-to-check, cin-pd-hard-swap-on-cause]
avoid_with: [cinematic-halation-bloom, kcut-flood-climax]
needs: []
drawn: cinetic
---

# Anticipation dip before an unlock

cinetic `mi-anticipation-dip-unlock` · Micro-interaction · signature · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Light builds on a locked card, the card briefly darkens as the lock's shackle swings open, then it pops to clean full-tone content, so the release feels bigger than it is.

Use when: Something locked, gated or hidden becomes available (an unlock, a reveal, access granted) and the moment should land as a payoff.

## Build it in Zenvi

1. The locked card and the clean card are two clips butted on one track: `add_clip_to_timeline_tool {"file_id": "<locked_art>", "position_seconds": 0.0, "duration_seconds": 0.6, "track": "2"}` and `add_clip_to_timeline_tool {"file_id": "<clean_art>", "position_seconds": 0.6, "duration_seconds": 2.0, "track": "2"}`; swap on one frame, hidden inside the brightness pulse, never crossfaded.
2. Brightness chain on both: `add_effect_tool {"timeline_clip_id": "<locked>", "effect": "Brightness"}` then `update_effect_tool {"timeline_clip_id": "<locked>", "effect": "Brightness", "properties": {"brightness": [{"time": 0.0, "value": 0.0}, {"time": 0.233, "value": 0.3, "interpolation": "bezier"}, {"time": 0.433, "value": -0.15}]}}` (build 1.0 to 1.5x over 14 f = 0.23 s on an ease-in, dip to 0.8x over 12 f = 0.2 s on an ease-out; check the range with `list_effects_tool`).
3. On the pop frame (0.6 s) the clean card flashes to 1.35x and returns: a pulse, not a spring. Brightness value 0.25 down to 0 over 12 f (0.2 s) (7 f / 0.12 s on a repeat), plus `scale_x`/`scale_y` 1.024 to 1.0 over 12 f on `ease_out_expo`.
4. During the dip the shackle (its own clip) rotates -30 degrees about its hinge and lifts 4 px: `set_keyframes_tool {"timeline_clip_id": "<shackle>", "property": "rotation", "points": [{"seconds": 0.233, "value": 0}, {"seconds": 0.433, "value": -30, "ease": "ease_out_expo"}]}` with `origin_x`/`origin_y` at the hinge point.
5. Repeat faster on a second card (7 f pop instead of 12 f) so the second read is snappier. `add_sfx_tool {"recipe": "pop", "at_seconds": 0.6, "gain_db": -16}`.

## Timing & taste rules

- cinetic's timing (60 fps): Build 14 f (0.23 s) ease_in_cubic to 1.5x. Dip 12 f (0.20 s) ease_out_expo to 0.8x, with the shackle at -30 degrees. Pop 12 f (7 f (0.12 s) on the repeat) with a hitPulse(t, 3, 6) brightness pulse and a 2.4% scale pulse. About 38 f (0.63 s) in all.
- Build 14 f (0.23 s) ease-in to 1.5x; dip 12 f (0.2 s) ease-out to 0.8x; pop 12 f (0.2 s), 7 f (0.12 s) on a repeat; about 38 f (0.63 s) in all.
- Pop brightness pulse 1 + 0.35 and a 2.4 % scale pulse, a pulse not a spring.
- Shackle -30 degrees about its hinge, lifted 4 px.
- Swap art on exactly one frame.

## Sound for it

A pop or hit_transient at -16 dB on the pop frame; a faint reverse_swell at -26 dB under the build if the card is the hero.

## Common mistakes

- Brightness clipping the whites into a bloom.
- The film already has two big payoff beats.
- Crossfading locked and clean art instead of swapping on one frame.
- Avoid when: The brightness would clip whites into a bloom, or the film already has two big payoff beats.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-anticipation-dip-unlock`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
