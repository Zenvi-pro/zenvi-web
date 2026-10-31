---
id: cin-cl-drain-stage-keep-hero
kind: technique
summary: "When a found item must be isolated or a section closed: the world drains to dark or white while the hero stays crisp."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [apply_look_preset_tool, set_keyframes_tool, add_title_tool, duplicate_clips_tool, add_effect_tool]
pace: calm
mood: [isolating, clean, hushed]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-pullback-isolation, cin-cl-context-palette-shift, shot-contact-shadow-lift]
avoid_with: [cin-cl-duotone-until-featured, shot-spotlight-hero-card]
needs: []
drawn: cinetic
---

# Drain the stage, keep the hero

cinetic `cl-drain-stage-keep-hero` · Colour and light · workhorse · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Everything around the hero fades and the world drops to dark or bleaches to white, while the hero stays crisp in place, isolating it or closing a section.

Use when: Search results, a found item, a selected post or row, the moment before a detail view, and the ends of sections or of the film.

## Build it in Zenvi

1. The hero (card, row, result) stays on its own track above the world, never moving; give it a soft lift: `apply_look_preset_tool {"timeline_clip_id": "<hero>", "look": "shadow_soft"}` and `set_keyframes_tool {"timeline_clip_id": "<hero>", "property": "corner_radius", "points": [{"seconds": 3.0, "value": 0}, {"seconds": 3.2, "value": 20, "ease": "ease_out_cubic"}]}`.
2. Drain the world to dark: a cover on a track between the world and the hero, `add_title_tool {"text": " ", "background_color": "#14151a", "position_seconds": 3.0, "duration_seconds": 2.0, "track": "<between>"}` with `set_keyframes_tool {"timeline_clip_id": "<cover>", "property": "alpha", "points": [{"seconds": 3.0, "value": 0}, {"seconds": 3.17, "value": 1, "ease": "ease_in_cubic"}]}` (10 f = 0.17 s), hold about 30 f (0.5 s). For a light film cover with `#ffffff` over 6-16 f (0.1-0.27 s) linear and assemble the next page around the parked hero.
3. Focus variant for side columns: `duplicate_clips_tool {"timeline_clip_ids": ["<column>"]}`, `add_effect_tool {"timeline_clip_id": "<column_copy>", "effect": "Blur"}` at about 8 px, then crossfade the copy in with `set_keyframes_tool {"property": "alpha", "points": [{"seconds": 3.0, "value": 0}, {"seconds": 3.3, "value": 1, "ease": "ease_in_out_sine"}]}` (18 f = 0.3 s) and drop the sharp column to 0.6; the centre column is untouched while the parent scales 1.0 to 1.06.
4. Exhale: dim the stage first (cover alpha 0 to 1 over 36 f = 0.6 s), fade the hero 8 f (0.13 s) later over 30 f (0.5 s), and end on a hard cut mid-film or a short ink tail only at the very end.

## Timing & taste rules

- cinetic's timing (60 fps): Neighbours fade over 12 f (0.20 s) on linear, the world dims over 10 f (0.17 s) on ease_in_cubic, then hold about 30 f (0.50 s). A white drain takes 6-16 f (0.27 s) on linear. Column focus takes 18 f (0.30 s) on ease_in_out_sine. In the exhale, the stage fades over 36 f (0.60 s) and the hero over 30 f (0.50 s) starting 8 f (0.13 s) later, with a tail of up to 22 f (0.37 s); a push-in dim takes 8 f (0.13 s) on ease_in_cubic.
- Neighbours fade over 12 f (0.2 s, linear); the world dims over 10 f (0.17 s, ease_in_cubic), then holds about 30 f (0.5 s).
- White drain takes 6-16 f (0.1-0.27 s, linear).
- Column focus is a crossfade between a sharp and a blurred copy over 18 f (0.3 s) with blur about 8 px; never an animated blur.
- Exhale: stage fades over 36 f (0.6 s), hero over 30 f (0.5 s) starting 8 f later, tail up to 22 f (0.37 s).
- Hold 90-120 f (1.5-2.0 s) on a finished lockup before the exhale.

## Sound for it

Nothing on the drain; a very low `tail_bloom` (-20 dB) under the exhale at the end of a section is enough.

## Common mistakes

- The hero moves during the isolation; it should be parked.
- Draining neighbours that carry context the viewer still needs.
- Animating a blur filter on the columns instead of crossfading a blurred copy.
- Avoid when: The hero itself must move during the isolation, or the neighbours carry context the viewer still needs.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-drain-stage-keep-hero`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
