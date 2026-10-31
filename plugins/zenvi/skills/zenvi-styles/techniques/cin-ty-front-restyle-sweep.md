---
id: cin-ty-front-restyle-sweep
kind: technique
summary: "When a landed word should have a moment of discovery: a front sweeps over it and restyles each letter as it passes."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, duplicate_clips_tool, add_shape_mask_tool, add_sfx_tool]
pace: medium
mood: [revealing, sleek]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-emphasis-scale]
avoid_with: [shot-gradient-word-sweep]
needs: [per-glyph-weight-morph]
drawn: cinetic
---

# Travelling front restyles a word

cinetic `ty-front-restyle-sweep` · Typography in motion · accent · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A front sweeps left to right across a settled word and restyles each glyph as it passes, in colour or weight, sometimes with a cursor riding under it.

Use when: Turning a static big word into a moment of discovery; emphasising one or two promise words without a highlight shape; a change of voice mid-sentence.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same muted title and one ink copy as above, but the front is one-hue: muted to accent to ink through the two masked copies, no multi-hue band.
2. Weight change instead of a serif or italic switch: three copies of the word in the film's one sans at weights 400, 500 and 700 revealed with the same masked front, so the letters thicken as the front passes. No gradient colours.

**Full look** (relies on gradient, serif, italic: only when the person's brand supplies that look):

1. `add_kinetic_title_tool {"text": "Meet Pulse", "style": "creator", "animation": "fade", "emphasis": "none", "ink": "#8a8f98", "text_size": 0.12, "position_seconds": 1.0, "duration_seconds": 4.0}` (the word in its muted state).
2. `duplicate_clips_tool {"timeline_clip_ids": ["<title>"], "to_track": "4", "position_seconds": 1.0}` and recolour the copy to the ink or accent colour with `edit_title_tool {"timeline_clip_id": "<copy>", "text_color": "#ffffff"}`.
3. Mask the copy so the front reveals it left to right, starting 10 f (0.17 s) after the word lands: `add_shape_mask_tool {"clip_ids": ["<copy>"], "shape": "rectangle", "x": 0.5, "y": 0.5, "width": 0.6, "height": 0.25, "feather": 0.04, "keyframes": [{"seconds": 1.5, "grow": -0.6}, {"seconds": 2.03, "grow": 0}]}` (the sweep takes 32 f, 0.53 s).
4. The accent step in the middle: a second copy in the accent colour masked on a narrower window travels first, so each letter goes muted, accent, ink.
5. `add_sfx_tool {"recipe": "sparkle", "at_seconds": 1.5, "gain_db": -20}`.

Fallback: A per-glyph weight morph is not available; stack two or three weight copies with the masked front.

## Timing & taste rules

- cinetic's timing (60 fps): Sweep 32 f (0.53 s) ease_in_out_sine (front peaks about 29 px/f across a 600 px word; stretch to 40 f (0.67 s) for wider words); band 0.6 em; per-glyph weight morph about 4 f (0.07 s); a second word starts about 20 f (0.33 s) after the first; begin at least 10 f (0.17 s) after the word lands.
- Sweep 32 f (0.53 s) ease_in_out_sine; stretch to 40 f (0.67 s) for words wider than 600 px; front softness 0.6 em.
- Start at least 10 f (0.17 s) after the word lands; a second word starts about 20 f (0.33 s) after the first.
- One hue only (muted to accent to ink).
- Do not combine colour sweep and weight sweep in one film.

## Sound for it

A faint sparkle at -20 dB as the front starts, or none; do not follow the front with a sound.

## Common mistakes

- Text still moving while the sweep runs.
- Half-restyled frames that read as another word.
- Mixing colour and weight sweeps in the same film.
- Avoid when: Text still moving; sweeps whose half-restyled frames read as another word; colour and weight sweeps in the same film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-front-restyle-sweep`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
