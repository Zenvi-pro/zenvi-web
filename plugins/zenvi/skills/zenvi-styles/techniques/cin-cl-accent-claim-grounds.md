---
id: cin-cl-accent-claim-grounds
kind: technique
summary: "When a few big claims must beat the walkthrough: neutral grounds, with one full-bleed accent flood for the hero claim."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, add_kinetic_title_tool, add_shape_mask_tool, add_sfx_tool]
pace: medium
mood: [punctuated, bold, confident]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-rising-wash-carrier, cin-cl-inversion-card, kcut-flood-climax, cin-cl-accent-on-newest]
avoid_with: [cin-cl-mono-one-accent, cin-cl-context-palette-shift]
needs: []
drawn: cinetic
---

# Accent ground for claims only

cinetic `cl-accent-claim-grounds` · Colour and light · signature · energy medium · formats launch, feature, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Narrative shots sit on the neutral stage, other claims flip to the opposite neutral, and the single full-bleed accent ground is saved for the hero claim or the closing card, so colour works as punctuation.

Use when: Films with a few big statements that must feel louder than the walkthrough around them, and endings that need to feel conclusive.

## Build it in Zenvi

1. Story shots on the neutral stage: `add_title_tool {"text": "Meet the new editor", "background_color": "#f4f2ee", "text_color": "#111111", "position_seconds": 0, "duration_seconds": 1.5}`.
2. Other claims flip to the opposite neutral on a hard cut (ink after paper, paper after ink), the accent only on one key word: `add_kinetic_title_tool {"text": "Ten times *faster*", "emphasis": ["faster"], "accent": "<accent>", "ink": "#ffffff", "background": "#0b0b0c", "position_seconds": 1.5, "duration_seconds": 1.5}`.
3. Hero claim, the one accent ground of the film (72 f, 1.2 s): `add_title_tool {"text": "Finished in one prompt.", "background_color": "<accent>", "text_color": "#ffffff", "position_seconds": 6.0, "duration_seconds": 1.2, "track": "2"}`.
4. Make it arrive as a flood from the centre in 6 f (0.1 s): `add_shape_mask_tool {"clip_ids": ["<hero_title>"], "shape": "ellipse", "x": 0.5, "y": 0.5, "width": 1.4, "height": 1.4, "feather": 0.05, "keyframes": [{"seconds": 6.0, "grow": -0.7}, {"seconds": 6.1, "grow": 0}]}`.
5. `add_sfx_tool {"recipe": "hit_transient", "at_seconds": 6.0, "gain_db": -10}`.

Fallback: The cinetic flood steps the tint (75 %, 40 %, 0 %) on f0/f2/f4 and holds a ring at r 600 px for the shot; here the iris mask replaces the stepped tint and the ring is dropped.

## Timing & taste rules

- cinetic's timing (60 fps): Grounds swap on cut frames. The radial flood takes 6 f (0.10 s), with tint steps on f0 (0.00 s), f2 (0.03 s) and f4 (0.07 s) decided with fd(). The ring stays from f4 (0.07 s) to the end of the shot. Claim shots run 60-120 f (2.00 s) each.
- The accent floods the frame once per film (about 72 f, 1.2 s) or on the closing card; accent pixels stay near 8 % across the film.
- Grounds swap only on cut frames; elsewhere the accent is a one-word highlight.
- Radial flood takes 6 f (0.1 s); claim shots run 60-120 f (1.0-2.0 s).
- Check display type contrast on the accent ground before you commit.

## Sound for it

One soft hit on the flood frame of the hero claim only; the neutral ground swaps on cuts get none.

## Common mistakes

- An accent that fails contrast as a ground for display type.
- A film with no distinct claims (a pure UI tour); there is nothing to punctuate.
- Flooding the accent twice, which turns punctuation into wallpaper.
- Avoid when: The accent fails contrast as a ground for display type, or the film has no distinct claims (a pure UI tour).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-accent-claim-grounds`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
