---
id: cin-le-words-part-url-types
kind: technique
summary: "When the closing line is a short phrase plus a URL: the line splits and the URL types into the gap."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_kinetic_title_tool, fade_clip_tool, add_sfx_tool]
pace: calm
mood: [minimal, witty]
aspect: ["16:9", "1:1"]
pairs_with: [cin-le-living-hold, kinetic-typewriter]
avoid_with: [cin-le-accordion-cta-collapse]
needs: []
drawn: cinetic
---

# Words part, URL types into the gap

cinetic `le-words-part-url-types` · Logo and end card · accent · energy calm · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The closing line splits at its middle, both halves slide outward and dim, the URL types letter by letter into the gap, and the flanks fade so the URL holds alone.

Use when: The closing line is a two-word phrase or pun built around the product, and the CTA is a URL. Minimal, type-only films.

## Build it in Zenvi

1. Two flank titles meeting at centre: `add_title_tool {"text": "Make", "template": "Standard_1", "position_seconds": 1.0, "duration_seconds": 4.5, "track": "3"}` (left) and `{"text": "magic", ...}` (right), each placed so they meet with a word space.
2. Split them by +-(urlWidth/2 + 40 px) over 44 f (0.73 s): `set_keyframes_tool {"timeline_clip_id": "<left>", "property": "location_x", "ease": "ease_in_out_sine", "points": [{"seconds": 1.8, "value": 0}, {"seconds": 2.53, "value": -0.16}]}` and the mirror on `<right>` (250-300 px, peak 20 px/f or less); dim them with `alpha` 1 to 0.5.
3. From 40 % of the split (2.1 s) type the URL centred: `add_kinetic_title_tool {"text": "zenvi.com", "style": "documentary", "animation": "typewriter", "stagger_seconds": 0.067, "position_seconds": 2.1, "duration_seconds": 3.4}` (1 character per 4 f).
4. After the last key (about 2.7 s) fade the flanks: `fade_clip_tool {"clip_id": "<left>", "fade_out_seconds": 0.27}` and the right one, 16 f.
5. Keep the URL still while the card pushes 10-15 %. `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 2.1, "gain_db": -26}`.

## Timing & taste rules

- cinetic's timing (60 fps): Split: 44 f (0.73 s) on ease_in_out_sine over 250-300 px (peak 20 px/f or less). URL starts at 40% of the split, 4 f (0.07 s) per character. Flank fade: 16 f (0.27 s) after the last key. URL readable and still for at least 102 f (1.70 s).
- Split 44 f (0.73 s) ease_in_out_sine over 250-300 px; flanks dim but stay legible.
- URL starts at 40 % of the split, 1 character per 4 f (0.067 s), caret hidden once done.
- Flank fade 16 f (0.27 s) after the last key; URL readable and still for at least 102 f (1.7 s).
- Lines up to about 4 words.

## Sound for it

A light key tap on the first and last character of the URL, -26 dB; the split gets none.

## Common mistakes

- Lines longer than about 4 words.
- Films with no typing elsewhere: a new device at the very end.
- URLs too long for the gap to open within the safe width.
- Avoid when: Lines longer than ~4 words. Films with no typing anywhere else (it would add a new device at the very end). URLs too long for the gap to open within the safe width.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-words-part-url-types`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
