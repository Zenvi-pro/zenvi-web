---
id: shot-word-relay-filmstrip
kind: technique
summary: "When one subject has several abilities: a card column steps one notch per verb while the big serif verb swaps in place."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, kinetic-type-motion-design, animated-explainer]
tools: [add_clip_to_timeline_tool, add_kinetic_title_tool, get_clip_properties_tool, set_keyframes_tool, add_motion_template_tool, add_sfx_tool]
pace: medium
mood: [editorial, composed, premium]
aspect: ["16:9"]
pairs_with: [shot-blur-slide, kinetic-word-rotator, shot-title-demote-to-label]
avoid_with: [shot-text-column-converge, kinetic-beat-strobe, kinetic-word-pop]
needs: []
---

# Filmstrip of proof + word relay

## What it is
On the left a column of equal-height page cards (alternating dark and light so the movement shows); on the right a big serif line:
a fixed noun ("Shotcraft", upright) and a verb in white italic that changes in place ("frames", "builds", "ships"). The
column is still all the time and steps exactly one card only at the instant the verb changes: the left side is the evidence,
the right the claim. The verb block is centred on the active card's mid-line to the pixel. Capability tours, portfolios, case flows.

## Build it in Zenvi
Cards are native clips (screenshots or footage), scrolled in steps; the words are titles.
```json
add_clip_to_timeline_tool {"file_id": "<card 1>", "position_seconds": 0, "duration_seconds": 6, "track": "2"}      (repeat for cards 2-4 on tracks 3-5, all 6 s)
set_keyframes_tool {"timeline_clip_id": "<card k>", "property": "scale_x", "points": [{"seconds": 0, "value": <fit to ~45 % of the frame width>}]}     (scale_y the same)
set_keyframes_tool {"timeline_clip_id": "<card k>", "property": "location_y", "ease": "ease_in_out_quint", "points": [
  {"seconds": 1.8, "value": <y_k>}, {"seconds": 2.4, "value": <y_k - step>}, {"seconds": 3.8, "value": <y_k - step>}, {"seconds": 4.4, "value": <y_k - 2 step>}]}
add_kinetic_title_tool {"text": "Shotcraft", "style": "editorial", "animation": "fade", "emphasis": "none", "ink": "#9a968c", "text_size": 0.12, "y": 0.43, "position_seconds": 0, "duration_seconds": 6}
add_kinetic_title_tool {"text": "frames", "style": "editorial", "animation": "rise", "emphasis": "none", "ink": "#ffffff", "text_size": 0.12, "y": 0.57, "position_seconds": 0.2, "duration_seconds": 1.6}
(next verbs at 1.95 and 3.9, each 1.9 s; the old one is gone before the new one rises)
add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.8, "gain_db": -18}
```
Card step = card height + gap (the source used 530 px cards at 105 px spacing at 1080p). `add_motion_template_tool {"template": "grid"}` with a film_strip layout
is the shortcut when there is no per-card stepping. Dim the neighbours by keyframing each card's `alpha` (0.7 at distance 1, 0.5 at 2) and add a light blur.

## Timing & taste rules
- Stepped, never continuous: zero movement except a window of about 18 frames (0.6 s) on an asymmetric ease-in-out, exactly one card high, aligned to the verb swap (the scroll starts when the old word begins to grey, ends when the new one is settled).
- Word period 45-60 frames (1.5-2 s); under 40 neither the word nor the card reads.
- Verb swap: old word greys for 10 frames, exits up and out of its mask in 8 frames; the new word rises letter by letter 7 frames after the cut, 16 frames per letter, 1.2 frame stagger. Out first, then in: overlapping gives a double image (a rejected version read "resebuilds").
- Verb block centre = active card centre, to the pixel (more than 8 px off is visible, and the editorial composure goes).
- Neighbours darken 0.68 x distance, shrink to 0.94 and blur up to 3 px; more than 5 px blur and the cards stop looking like pages.
- Serif upright for the noun, italic white for the verb (the verb must be brighter than the noun); a sans face loses the editorial tone.
- Use real screenshots, light and dark tuned so the alternation is readable.

## Sound for it
A quiet tick or tap at each swap (-18 dB); nothing between swaps.

## Common mistakes
- Continuous scrolling: the column becomes wallpaper and the swap loses its click.
- The verb block aligned to the frame centre instead of the active card.
- Not a one-to-one match between each verb and the card showing it.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/word-relay-filmstrip.md` (Apache-2.0; see ../NOTICE).
