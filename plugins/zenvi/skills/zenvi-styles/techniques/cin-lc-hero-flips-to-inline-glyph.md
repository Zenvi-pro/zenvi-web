---
id: cin-lc-hero-flips-to-inline-glyph
kind: technique
summary: "When a hero icon should become the bullet of its claim: it shrinks into a slot in the sentence and the words spill out."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, inspect_timeline_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [clever, smooth, tidy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-lc-mark-as-inline-word, kinetic-emphasis-scale, kinetic-word-pop]
avoid_with: [cin-lc-one-centred-subject]
needs: [inline-glyph-slot]
drawn: cinetic
---

# Hero icon becomes the inline glyph

cinetic `lc-hero-flips-to-inline-glyph` · Layout and composition · accent · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The centred hero icon shrinks and travels into a slot at the start of, or inside, a sentence, and the words of the claim spill out of it, so the icon becomes a word.

Use when: Bridging from a hero object to a claim about it: an icon becoming the bullet of its benefit, a mark becoming the subject of a sentence, a feature glyph leading a metric line.

## Build it in Zenvi

1. Line first: `add_kinetic_title_tool {"text": "<em space> <benefit sentence>", "style": "editorial", "animation": "rise", "position_seconds": 0.9, "duration_seconds": 3.6, "stagger_seconds": 0.067, "text_size": 0.06, "y": 0.5}`. The leading em space reserves the slot one cap height wide; read where it lands with `inspect_timeline_tool` and note its centre (sx, sy) in frame fractions.
2. Hero icon centred, final size: `add_clip_to_timeline_tool {"file_id": "<icon>", "position_seconds": 0, "duration_seconds": 4.5, "track": 3}`; slot size is cap height, so end `scale_x/y` about 0.42 of its start.
3. Flip: `set_keyframes_tool {"timeline_clip_id": "<icon>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0.6, "value": 1.0}, {"seconds": 1.03, "value": 0.42, "ease": "ease_in_out_sine"}]}` and the same for `scale_y`; `location_x` and `location_y` from 0 to the slot offset on the same two times and ease. Optional wobble: `rotation` 0 to 10 and back to 0 over the same 26 f.
4. Words spill from behind the icon: the first word starts 2 f (0.03 s) after the icon lands, the next at +6 f (0.1 s), the next at +10 f (0.17 s), each a 14 f (0.23 s) slide of 24 px (0.022) with a 12 f colour resolve; the title's `rise` animation with `stagger_seconds` 0.067 is the nearest match.
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 1.03, "gain_db": -12}`.

Fallback: The slot is placed by eye from the preview, not by measurement; the colour-resolve (muted to ink) and the 3D wobble are not available on title clips, so use a plain rise and a 2D rotation wobble.

## Timing & taste rules

- cinetic's timing (60 fps): Icon travel 22-30 f (0.50 s) on ease_in_out_sine, scaling to about 0.42 (cap height). Words at icon landing + 2, + 6 and + 10 f (0.17 s), each a 14 f (0.23 s) slide of 24 px with a 12 f (0.20 s) colour resolve. Residual drift 0.5-1 px/f.
- Icon travel 22-30 f (0.37-0.5 s) on ease_in_out_sine; ends at about 0.42x (cap height, 50-90 px at 1080p).
- Words: icon landing + 2 f, + 6 f, + 10 f; each a 14 f (0.23 s) slide of 24 px with a 12 f (0.2 s) fade up.
- Residual drift 0.5-1 px/f (30-60 px/s) on the line after it settles.
- Blur the icon only while it moves faster than 12 px/f.
- Lay the final sentence out first; the slot must not move when the words land.

## Sound for it

One soft pop on the frame the icon lands in its slot (-12 dB); the words get no sound of their own.

## Common mistakes

- Detailed icons that do not read at cap height.
- Sentences long enough to wrap: the slot would move.
- Starting the words before the icon arrives: the icon must lead.
- Avoid when: Detailed icons that will not read at cap height (50-90 px), or sentences long enough to wrap.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-hero-flips-to-inline-glyph`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
