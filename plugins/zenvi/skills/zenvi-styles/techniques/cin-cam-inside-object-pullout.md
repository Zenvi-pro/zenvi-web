---
id: cin-cam-inside-object-pullout
kind: technique
summary: "When a reveal is about scale: open on a colour field or card, then one long pull shows it was a small object."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [witty, revealing, designed]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-ui-to-brand-morph, t069]
avoid_with: [cin-tr-scale-through-cut]
needs: []
drawn: cinetic
---

# Pull out from inside the object

cinetic `cam-inside-object-pullout` · Camera · signature · energy medium · formats launch, sting, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The shot opens on what reads as a full-bleed colour field or a statement card, and one long pull reveals it was the face of a small object (an app icon, a card, a screen, the mark) sitting among its neighbours.

Use when: Cold opens and hooks where a calm statement or a colour field should turn out to be part of the product (the question was printed on the app icon, the colour was one card in the grid); landing the mark into the final lockup; any reveal whose point is scale.

## Build it in Zenvi

1. The context image at true size (a dock, grid, window or lockup, exported at 4K or larger so the 8-14x close-up stays sharp; never an upscaled bitmap): `add_clip_to_timeline_tool {"file_id": "<context>", "position_seconds": 0, "duration_seconds": 4, "track": 1}`.
2. Face hold: the object's face fills the frame with k0 = 1.04 x the cover scale (about 13.3 for a 144 px icon at 1920 wide), with a creep of 0.04-0.07 %/f, for 24-48 f (0.4-0.8 s). Set `origin_x` / `origin_y` on the object's centre.
3. The pull in log-spaced keyframes so the perceived speed stays even (scale interpolates linearly, so approximate the log curve): `set_keyframes_tool {"timeline_clip_id": "<context>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0.6, "value": 13.3}, {"seconds": 0.93, "value": 7.0, "ease": "ease_in_out_sine"}, {"seconds": 1.27, "value": 3.65, "ease": "ease_in_out_sine"}, {"seconds": 1.6, "value": 1.91, "ease": "ease_in_out_sine"}, {"seconds": 1.7, "value": 1.0, "ease": "ease_out_expo"}]}`, same on `scale_y`: N = 25.7 x ln(k0) = ~66 f (1.1 s) from 13.3x, ~53 f from 8x. No overshoot.
4. The opening copy on its own clip at screen space, shrinking more slowly (k^0.46), fading out as the object's width falls from 1.3x to 1.0x the copy's: `add_kinetic_title_tool {"text": "What are you making?", "position_seconds": 0, "duration_seconds": 1.4, "style": "documentary", "animation": "fade"}` with `scale_x/scale_y` 1.0 to 0.6 and `alpha` 1 to 0 over 8-14 f (0.13-0.23 s).
5. The next beat (an icon hop, a wordmark build) starts within 12 f (0.2 s) of the settle. `add_sfx_tool {"recipe": "whoosh_fall", "at_seconds": 0.6, "gain_db": -14}`.

Fallback: The 8-14x close-up of a bitmap falls apart; render the face large, or use a vector asset exported at 8K.

## Timing & taste rules

- cinetic's timing (60 fps): Face hold 24-48 f (0.80 s) for the read, with a 0.04-0.07%/f creep. Pull from k0 = 8-14 to 1 over N = 25.7 x ln(k0) frames on ease_in_out_sine (about 53 f (0.88 s) from 8x, 66 f (1.10 s) from 13.3x), log rate peaking near 6%/f mid-move and landing at rest. Copy scale tracks k ** 0.46 and fades over the 8-14 f (0.23 s) in which the object's width passes 1.3x -> 1.0x the copy width. Anchor travel to the slot under 10 px/f. --blur for frames above 12 px/f.
- Face hold 24-48 f (0.4-0.8 s) with a 0.04-0.07 %/f creep.
- Pull from k0 = 8-14 to 1 over N = 25.7 x ln(k0) frames (about 53 f / 0.9 s from 8x, 66 f / 1.1 s from 13.3x), log rate peaking near 6 %/f mid-move and landing at rest, no overshoot.
- Copy scale tracks k^0.46 and fades over the 8-14 f (0.13-0.23 s) in which the object's width passes 1.3x to 1.0x the copy's.
- Anchor travel to the slot under 10 px/f; blur frames above 12 px/f.
- Corners, shadow and neighbours arrive by coverage alone, with no fades of their own.

## Sound for it

A single falling whoosh across the pull; the next beat's hit lands on the settle.

## Common mistakes

- The face is a photo or bitmap (it falls apart at 8-14x), the context is not recognisable at a glance, or a scale-through cut or detail-first pull-back already used the same object (avoid_when). Once per film.
- Linear scale interpolation with two keyframes: the pull is front-loaded and feels fast then crawls; add the log-spaced points.
- Fading neighbours in: they must arrive by coverage.
- Avoid when: The face is a photo or bitmap (it falls apart at 8-14x), the context it lands in is not recognisable at a glance, or a scale-through cut or detail-first pull-back has already used the same object. Once per film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-inside-object-pullout`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
