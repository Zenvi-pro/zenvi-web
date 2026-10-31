---
id: cin-mi-shape-handoff-morph
kind: technique
summary: "When a prompt or button hands off to the product, a capsule empties, collapses to a tile and becomes the next thing."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, add_motion_block_tool, reverse_clip_tool, set_keyframes_tool, add_type_block_tool, add_shape_mask_tool, add_sfx_tool]
pace: medium
mood: [continuous, playful, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-ui-to-brand-morph, cin-ui-container-morph, cin-mi-spinner-to-check]
avoid_with: [cin-mi-pre-event-tell, shot-glitch-tear-cut]
needs: []
drawn: cinetic
---

# Shape handoff: pill becomes the icon

cinetic `mi-shape-handoff-morph` · Micro-interaction · signature · energy medium · formats launch, feature, walkthrough, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A labelled capsule empties its text, then collapses at a fixed height into a square tile or circle that becomes the next thing (the app icon, a loader or a dock slot), so the object never disappears, it changes role.

Use when: A thinking state, prompt or button should hand off to the product identity, or to its new place in the interface, in one continuous take.

## Build it in Zenvi

1. One block owns the shape: `add_title_tool {"text": " ", "background_color": "<ink>", "fit_text": false, "position_seconds": 0.0, "duration_seconds": 3.0, "track": "2"}`; the label is a separate title on track 3.
2. Empty the label first: backspace one character every 1-2 f (0.02-0.03 s) from the end (type it with `add_motion_block_tool {"block": "prompt_bar", ...}` and play it backwards with `reverse_clip_tool`, or place one title clip per remaining length), or delete from both ends every 5 f (0.08 s); the pill width hugs the text over 8 f (0.13 s) per step on `ease_out_expo`.
3. Collapse the width down to the height about the centre over max(40 f, travel / 7) = 0.67 s or longer on `ease_in_out_expo` so each edge stays under about 55 px/f: `set_keyframes_tool {"timeline_clip_id": "<pill>", "property": "scale_x", "points": [{"seconds": 1.0, "value": <wide>}, {"seconds": 1.67, "value": <tile>, "ease": "ease_in_out_expo"}]}` with `corner_radius` from fully round to 22 % of the side (50 % for a circle).
4. Then one of three: a loader (a 3x3 dot ring: `add_type_block_tool {"block": "text_on_path", "text": "· · · · · · · ·", "shape": "ring", "spin": 360}`, one step per 6 f / 0.1 s, holding about 72 f / 1.2 s); an arrow glyph that rises into the circle over 14 f (0.23 s) on `ease_out_expo` through a mask (`add_shape_mask_tool`); or the tile moving to a dock slot over 20 f (0.33 s) on `ease_out_expo` while `add_motion_block_tool {"block": "dock_magnify", ...}` mounts behind it.
5. Close with a 5 % scale pulse (1.05 and back, about 5 f / 0.08 s) just before the cut. `add_sfx_tool {"recipe": "pop", "at_seconds": 1.67, "gain_db": -20}`.

## Timing & taste rules

- cinetic's timing (60 fps): Backspace 1 character every 1-2 f (0.03 s) (pairs every 5 f (0.08 s), width hug 8 f (0.13 s) ease_out_expo). Collapse max(40, edge travel / 7) f on ease_in_out_expo at a fixed height (each edge under about 55 px/f). Dock variant 20 f (0.33 s) ease_out_expo plus ease_out_cubic siblings at 6 f (0.10 s). The loader holds about 72 f (1.20 s).
- Backspace 1 character every 1-2 f (0.02-0.03 s); width hug 8 f (0.13 s) per step.
- Collapse max(40 f, edge travel / 7) = at least 0.67 s on ease_in_out_expo, each edge under about 55 px/f; radius 999 to 22 % of the side (tile) or 50 % (circle).
- Dock variant 20 f (0.33 s) with siblings scaling in 6 f (0.1 s) apart; the loader holds about 72 f (1.2 s).
- Scale pulse 1.05 just before the cut.

## Sound for it

A faint keyboard_key per backspace (or none) and one pop at -20 dB when the tile lands.

## Common mistakes

- The target shape has nothing to do with the source: the continuity feels arbitrary.
- A shot that needs a hard cut for rhythm.
- Shrinking faster than the edge-speed limit: the morph smears.
- Avoid when: The target shape has nothing to do with the source (the continuity feels arbitrary), or the shot needs a hard cut for rhythm.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-shape-handoff-morph`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
