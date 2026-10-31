---
id: cin-ty-shared-letter-morph
kind: technique
summary: "When two words share letters and their link is the point: shared letters stay, the new ones tumble in and click upright."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [playful, precise]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-type-morph, cin-ty-reading-order-exit]
avoid_with: [cin-ty-blur-swap-rescale]
needs: [shared-letter-glyph-mapping]
drawn: cinetic
---

# Shared-letter morph

cinetic `ty-shared-letter-morph` · Typography in motion · accent · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

One word turns into another: the letters both words share stay and slide into place while the new letters tumble in and click upright.

Use when: Two words that share letters and whose relationship is the point (before and after, problem and product); one memorable word turn per film.

## Build it in Zenvi

1. Nearest block: `add_motion_block_tool {"block": "type_morph", "position_seconds": 1.0, "duration_seconds": 3.0, "placement": "full_frame", "params": {"words": ["PLAN", "PLANET"], "beat": 1.2, "morph": 0.6, "sweep": 0.5, "style": "fill", "color": "ink", "max_size": 230}}` melts the outlines left to right.
2. For the real shared-letter version build each glyph as a title: `add_kinetic_title_tool {"text": "P L A N", "animation": "fade", "stagger_seconds": 0, ...}` for the shared letters, then slide them to their new x with `set_keyframes_tool {"timeline_clip_id": "<glyph>", "property": "location_x", "ease": "ease_out_expo", "points": [{"seconds": 2.0, "value": 0}, {"seconds": 2.4, "value": <dx>}]}` (24 f, 0.4 s).
3. New letters: `add_kinetic_title_tool {"text": "E", "animation": "fade", ...}` each with `location_x/y` from +-0.08 / +-0.11 to 0, `rotation` 90-180 to 0 over 0.4 s `ease_out_expo`, `alpha` 0 to 1 over 0.2 s, starts spread over 0.93 s (56 f); the last glyph drops from above.
4. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <each landing>, "gain_db": -22}` on 2-3 of the landings only.

Fallback: Use the type_morph block alone: letters flow into the next word instead of the shared ones staying put.

## Timing & taste rules

- cinetic's timing (60 fps): Space collapse 8 f (0.13 s); old glyph fade 6 f (0.10 s); each new glyph 24 f (0.40 s) ease_out_expo (about 45 px/f on frame 1), opacity 12 f (0.20 s); starts spread over 56 f (0.93 s); hold at least 36 f (0.60 s) after the last glyph settles.
- Space collapse 8 f (0.13 s); old unshared glyphs fade over 6 f (0.1 s).
- Each new glyph 24 f (0.4 s) ease_out_expo from +-150 px x, +-120 px y, 90-180 degrees; opacity over the first 12 f.
- Landing starts spread over 56 f (0.93 s); hold at least 36 f (0.6 s) after the last one settles.
- Check every frame: no in-between state may spell a third word.

## Sound for it

A few soft taps as the last letters click upright, -22 dB; none on the slide of the shared letters.

## Common mistakes

- Fewer than two shared letters or words over about 8 letters.
- Fast films, where 60 f of letter flight is too slow.
- More than one word turn per film.
- Avoid when: Fewer than 2 shared letters; words longer than about 8 letters; fast films where 60 f of letter flight is too slow.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-shared-letter-morph`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
