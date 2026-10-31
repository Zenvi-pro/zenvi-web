---
id: cin-lc-mark-as-inline-word
kind: technique
summary: "When a logo should read like a word: it sits in the sentence at cap height and fades in after the first word."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, inspect_timeline_tool, add_clip_to_timeline_tool, set_clip_property_tool, set_keyframes_tool]
pace: calm
mood: [quiet, tidy, premium]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-lc-hero-flips-to-inline-glyph, kinetic-letter-swap, shot-blur-slide]
avoid_with: [t069, cin-lc-one-centred-subject]
needs: [inline-glyph-slot]
drawn: cinetic
---

# Mark set as a word

cinetic `lc-mark-as-inline-word` · Layout and composition · accent · energy calm · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A logo, partner mark or icon sits inside a sentence on the baseline at cap height, as if it were a word, appearing with its own delayed fade or swapping with a word in the same slot.

Use when: Co-branding inside a claim, naming a platform or integration without a separate logo slate, or turning a generic noun into the product name in place.

## Build it in Zenvi

1. The line with the slot reserved: `add_kinetic_title_tool {"text": "Now shipping on <em space>", "style": "editorial", "animation": "rise", "stagger_seconds": 0.133, "position_seconds": 0, "duration_seconds": 3.2, "text_size": 0.06, "y": 0.5}`. Find the slot centre with `inspect_timeline_tool` (one space width after the last word, bottom on the baseline).
2. Mark at cap height, no scale pop: `add_clip_to_timeline_tool {"file_id": "<logo>", "position_seconds": 0, "duration_seconds": 3.2, "track": 3}`, size it to the cap height with `set_clip_property_tool` (scale), place it with `location_x/y`.
3. Delayed fade, 17 f (0.28 s) after the first word starts: `set_keyframes_tool {"timeline_clip_id": "<logo>", "property": "alpha", "mode": "replace", "points": [{"seconds": 0.28, "value": 0}, {"seconds": 0.38, "value": 1, "ease": "ease_in_out_sine"}]}` (6 f, 0.1 s).
4. Slot swap, if the mark changes into another: the outgoing mark `location_y` 0 to -0.0074 and `alpha` 1 to 0, the incoming from +0.0074 to 0 and 0 to 1, both over 8 f (0.13 s) with `ease_out_cubic`.

Fallback: The slot is placed by eye from the preview; there is no baseline-aware inline image on title clips.

## Timing & taste rules

- cinetic's timing (60 fps): Mark appears about 17 f (0.28 s) after the first word with a 4-6 f (0.10 s) fade. Slot swap 8 f (0.13 s) with 8 px travel. The line then drifts at 0.5 px/f.
- Words stagger 8 f (0.13 s); the mark appears about 17 f (0.28 s) after the first word with a 4-6 f (0.07-0.1 s) fade and no scale pop.
- Slot swap 8 f (0.13 s), 8 px (0.0074) of travel each way.
- Mark height equals the cap height; margin-left one space width; the slot is reserved so nothing reflows.
- The line then drifts at 0.5 px/f (30 px/s).

## Sound for it

None; a mark fading into a sentence is silent.

## Common mistakes

- Marks with fine detail or wide aspect ratios that cannot read at cap height.
- Using it for the film's own final lockup, which appears once, at the end, on its own.
- Popping the mark with a scale: it should arrive like a word, not like a sticker.
- Avoid when: Marks with fine detail or wide aspect ratios that cannot read at cap height, or the film's own final lockup, which appears once, at the end, on its own.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-mark-as-inline-word`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
