---
id: cin-mi-velocity-stretch-dot
kind: technique
summary: "When a small dot must lead the eye, it stretches along its motion by its speed and shrinks back to a dot when it stops."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_emoji_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [alive, elastic, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-shared-highlight-walk, cin-mi-guide-cursor-hover-press, shot-attention-bounce]
avoid_with: [kcut-hit-fx]
needs: [velocity-stretch-capsule]
drawn: cinetic
---

# Velocity-stretch dot

cinetic `mi-velocity-stretch-dot` · Micro-interaction · signature · energy medium · formats feature, walkthrough, launch, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A small round dot (a cursor or a list marker) stretches into a capsule along its motion in proportion to its speed, anchored at its trailing end, and shrinks back to a dot when it stops.

Use when: A tiny element must lead the eye across a slab or down a list, and needs speed, direction and character.

## Build it in Zenvi

1. The dot: `add_emoji_tool {"emoji": "black circle", "size": 0.045, "position_seconds": 0.0, "duration_seconds": 4.0}` (3.3-5.3 % of frame height for a cursor, white on dark; 18-21 px for a list marker in the accent).
2. Head path: `location_x`/`location_y` points with eases (`ease_out_expo`, `ease_in_out_sine`) sampled every 2 f (0.03 s).
3. Stretch in proportion to speed, anchored at the trailing end: set `rotation` to the path angle, `origin_x` at the trailing end, and `scale_x` = 1 + (4-5.5 f of travel x speed) / dot_width, easing back to 1 in 16-20 f (0.27-0.33 s) after the stop; `scale_y` stays 1: `set_keyframes_tool {"timeline_clip_id": "<dot>", "property": "scale_x", "points": [{"seconds": 0.0, "value": 6.0}, {"seconds": 0.52, "value": 1.0, "ease": "ease_out_expo"}]}`.
4. Marker mode: drop it from the top edge over 31 f (0.52 s) on `ease_out_expo` so it arrives as a long streak that shortens into the dot. Hop 54 px (0.05 of height) to the next item over 22 f (0.37 s) on `ease_in_out_sine` every 54 f (0.9 s); the active label goes from grey to ink over 8 f (0.13 s) around the midpoint.
5. Exit: stretch to a dash about four times the dot length (about 84 px for a 21 px marker) over 17 f (0.28 s) on `ease_in_out_sine`, then shoot off on `ease_in_cubic`. Nothing is drawn behind it: the stretch is the streak.
6. `add_sfx_tool {"recipe": "swish_airy", "at_seconds": 0.0, "gain_db": -26}` on the drop only.

Fallback: Scaling a circle makes an ellipse, not a capsule with round caps; it reads as a streak at speed. A truly capsule-shaped stretch needs a drawn line.

## Timing & taste rules

- cinetic's timing (60 fps): Tail weights 0.8^i over 30 f (0.50 s) (a lag of about 4 f (0.07 s)): length about rest + 4-5.5 f (0.09 s) x speed, back to a dot in 16-20 f (0.33 s). Marker: drop 31 f (0.52 s) ease_out_expo; hop 54 px in 22 f (0.37 s) ease_in_out_sine every 54 f (0.90 s); label colour 8 f (0.13 s); exit: stretch to an ~84 px dash over 17 f (0.28 s) (ease_in_out_sine), then off on ease_in_cubic.
- Trailing lag of about 4 f (0.07 s): stretch length is rest + 4-5.5 f of travel x speed; back to a dot in 16-20 f (0.27-0.33 s).
- Marker drop 31 f (0.52 s) on ease_out_expo; hop 54 px in 22 f (0.37 s); cadence 54 f (0.9 s).
- Exit stretch to about 4x the dot length over 17 f (0.28 s), then off on ease_in_cubic.
- Flat fill, no shadow, no trail behind it.

## Sound for it

One soft swish_airy at -26 dB on the drop; the hops are silent.

## Common mistakes

- UI truth requires a standard system arrow.
- Several dots stretching at once: the trick only reads once.
- Adding a motion trail behind the stretch: it double-counts the speed.
- Avoid when: UI truth requires a standard system arrow, or several dots would stretch at once (the trick only reads once).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-velocity-stretch-dot`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
