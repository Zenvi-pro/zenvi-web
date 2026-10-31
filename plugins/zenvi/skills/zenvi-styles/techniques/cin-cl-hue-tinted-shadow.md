---
id: cin-cl-hue-tinted-shadow
kind: technique
summary: "When cards or black pills float on a pale tinted stage: their shadow is a dark step of the stage's own hue, not grey."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, add_shape_mask_tool, set_keyframes_tool, apply_look_preset_tool]
pace: calm
mood: [soft, pastel, dimensional]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-context-palette-shift, shot-contact-shadow-lift, cin-cl-living-stage]
avoid_with: [cin-cl-key-light-edge-hairline, cin-cl-mono-one-accent]
needs: []
drawn: cinetic
---

# Shadows tinted by the stage

cinetic `cl-hue-tinted-shadow` · Colour and light · accent · energy calm · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

On a tinted light stage, lifted cards and solid pills cast soft shadows in a dark step of the stage's own hue instead of grey, so depth reads as part of the world's colour rather than dirt on it.

Use when: Light-mode acts on pale tinted stages, pastel product worlds, and black pills or tiles floating on a tinted field where a grey shadow looks muddy.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. One dark step of the stage's own hue, light stages only; shadows fall downward and never spread past about half the element's size.
2. `add_title_tool {"text": " ", "background_color": "<SH>", "position_seconds": 1.0, "duration_seconds": 4, "track": "<below_card>"}` with `add_shape_mask_tool {"clip_ids": ["<shadow>"], "shape": "ellipse", "x": 0.5, "y": 0.56, "width": 0.3, "height": 0.07, "feather": 0.4}` at alpha 0.25.
3. On dark stages drop the tint entirely and separate the cards with the edge hairline (cin-cl-key-light-edge-hairline).

**Full look** (relies on glow, gradient, orange, purple: only when the person's brand supplies that look):

1. Derive one shadow colour from the stage (never the accent): `<SH>` is the stage hue mixed 60 % toward black, e.g. a pale blue stage gives `#1d3354`.
2. The lifted card or pill sits on its track; under it, a shadow clip: `add_title_tool {"text": " ", "background_color": "<SH>", "position_seconds": 1.0, "duration_seconds": 4, "track": "<below_card>"}` plus `add_shape_mask_tool {"clip_ids": ["<shadow>"], "shape": "ellipse", "x": 0.5, "y": 0.58, "width": 0.4, "height": 0.1, "feather": 0.5}`: an ellipse 80 % of the element's width and 30 % of its height, offset down 40 % of its height, alpha about 0.35 (`set_keyframes_tool` alpha 0.35).
3. Tie it to lift: when the card rises 1.0 to 1.04 over 20-26 f (0.33-0.43 s, ease_out_expo), spread and fade the shadow on the same curve: `set_keyframes_tool {"timeline_clip_id": "<shadow>", "property": "scale_x", "points": [{"seconds": 2.0, "value": 1}, {"seconds": 2.4, "value": 1.12, "ease": "ease_out_expo"}]}` and `alpha` 0.35 to 0.31.
4. For a plain white card add the neutral contact shadow only: `apply_look_preset_tool {"timeline_clip_id": "<card>", "look": "shadow_subtle"}` (the tinted ambient is the clip above).
5. Palette switches retint the shadow on the cut: swap `background_color` to the new `<SH>` in 0 f.

Fallback: The two-shadow card (a grey contact shadow plus a tinted ambient one) is the shadow look plus the tinted ellipse; the look's own shadow is grey, only the ellipse is tinted.

## Timing & taste rules

- cinetic's timing (60 fps): Static while parked. On a lift (scale 1 to 1.04 over 20-26 f (0.43 s) on ease_out_expo), the ambient blur goes from about 56 to 63 px and the alpha from 0.22 to 0.20 on the same curve. On seating, it returns on the seat move's own easing. A palette switch retints the shadows in 0 f (0.00 s), on the cut.
- Shadow colour = stage hue mixed 60 % toward ink; ambient shadow about 0 24 px 56 px, alpha 0.22; contact shadow 0 2 px 6 px at 0.10.
- Under a black pill: one tinted ellipse, 80 % of the width, 30 % of the height, offset down 40 % of its height, blur about 32 px.
- Lift = scale minus 1; multiply offset and blur by 1 plus 3x lift and alpha by 1 over 1 plus 3x lift, so a rising card's shadow spreads and fades.
- A lift of 1 to 1.04 takes 20-26 f (0.33-0.43 s); a palette switch retints in 0 f.

## Sound for it

None; a shadow is a silent detail.

## Common mistakes

- Dark stages, where a coloured shadow becomes a glow.
- A tint that echoes the accent and spends its meaning.
- Soft multi-hue pastel blobs or coloured halos on three sides on a brand that bans glows or gradients.
- Avoid when: Dark stages, where a coloured shadow becomes a glow. Keep shadows neutral in neutral the paper films, and skip the tint wherever it would echo the accent and spend its meaning.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-hue-tinted-shadow`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
