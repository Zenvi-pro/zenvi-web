---
id: cin-mi-chip-bloom
kind: technique
summary: "When a tag or integration becomes a clickable thing, a tile widens into a labelled chip, or a pill swells behind a name."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_emoji_tool, set_keyframes_tool, add_title_tool, add_sfx_tool]
pace: medium
mood: [tactile, confirming, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-mark-docks-into-app, cin-mi-badge-count-bump, cin-mi-shape-handoff-morph]
avoid_with: [cin-ui-clutter-pileup-strip, kcut-hit-fx]
needs: []
drawn: cinetic
---

# Chip bloom around content

cinetic `mi-chip-bloom` · Micro-interaction · workhorse · energy medium · formats feature, walkthrough, launch, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A container grows out of its content: a dropped icon tile widens into a labelled chip that floods with the accent and wipes back to an outline, or a solid pill swells behind a name so the group becomes a button.

Use when: An integration, tag or name should become a tangible, clickable object (attached, added, now a button), shown as cause and effect.

## Build it in Zenvi

1. Tile to chip: the tile is a rounded clip with an icon (`add_emoji_tool {"emoji": "<icon>", "size": 0.08, "position_seconds": 0.0, "duration_seconds": 3.0}` over a solid block). On the drop, scale 0.8 to 1 over 8 f (0.13 s) on `ease_out_expo`.
2. The pill widens from the tile width (= its height) to label width plus padding over 12 f (0.2 s) `ease_out_expo`: `set_keyframes_tool {"timeline_clip_id": "<pill>", "property": "scale_x", "points": [{"seconds": 0.13, "value": 1.0}, {"seconds": 0.33, "value": <label_w / tile_w>, "ease": "ease_out_expo"}]}`, `corner_radius` fully round; on the same progress the icon slides to its left slot and the label (`add_title_tool {"text": "<name>"}`) fades in.
3. A flat accent fill covering the pill is wiped off left to right over 20 f (0.33 s) `ease_out_cubic`, leaving a 1.5 px border: `set_keyframes_tool {"timeline_clip_id": "<fill>", "property": "alpha", "points": [{"seconds": 0.33, "value": 1}, {"seconds": 0.67, "value": 0, "ease": "ease_out_cubic"}]}` over an outline clip.
4. Bloom behind a name: a pill clip behind the text grows from the text bounds to the bounds plus 48 px each side over 10 f (0.17 s) (`scale_x`, `scale_y` on `ease_out_expo`); the text switches from ink to white over 6 f (0.1 s), starting on the bloom's second frame, by crossfading two title clips.
5. Hold the finished chip at least 18 f (0.3 s). `add_sfx_tool {"recipe": "pop", "at_seconds": 0.0, "gain_db": -20}`.

Fallback: The wipe of the fill is a plain alpha fade; the left-to-right feathered erase would need an animated mask.

## Timing & taste rules

- cinetic's timing (60 fps): Tile pop 8 f (0.13 s) ease_out_expo; widen 12 f (0.20 s) ease_out_expo; fill wipe-off 20 f (0.33 s) ease_out_cubic with an 80 px feather; bloom behind 10 f (0.17 s) ease_out_expo with a 6 f (0.10 s) text inversion; hold at least 18 f (0.30 s).
- Tile pop 8 f (0.13 s) ease_out_expo; widen 12 f (0.2 s); fill wipe-off 20 f (0.33 s) with a soft 80 px edge.
- Bloom behind 10 f (0.17 s), text inversion 6 f (0.1 s) starting on the second frame.
- Hold the finished chip at least 18 f (0.3 s) before anything else happens.
- One flat accent only.

## Sound for it

One pop at -20 dB when the tile drops; the widening and wipe are silent.

## Common mistakes

- A fill that needs several hues to read.
- A chip with nothing to do next: a bloom with no follow-up reads as decoration.
- Skipping the 18 f hold: the chip is never seen.
- Avoid when: The fill would need several hues to read, or the chip has nothing to do next (a bloom with no follow-up reads as decoration).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-chip-bloom`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
