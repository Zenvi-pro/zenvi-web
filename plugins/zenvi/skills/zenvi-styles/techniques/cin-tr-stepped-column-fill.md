---
id: cin-tr-stepped-column-fill
kind: technique
summary: "When the stage colour changes behind a held hero: columns rise in a stepped pyramid until they close into a field."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting]
tools: [make_transition_mask_tool, add_transition_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [graphic, analytic, architectural]
aspect: ["16:9", "9:16"]
pairs_with: [kcut-flood-climax, shot-stagger-wave-grid, shot-aurora-flip]
avoid_with: [cin-tr-band-wipe, cin-tr-cover-wipe]
needs: [grid-cell-reflow]
drawn: cinetic
---

# Stepped column fill

cinetic `tr-stepped-column-fill` · Transition · accent · energy medium · formats sting, launch, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Columns rise from the bottom edge in a stepped pyramid centred under the hero, spreading outward until they close into one solid field that becomes the next stage behind it.

Use when: Marks built from bars, steps or pixels; data and analytics products, where the columns read as a chart; stings and loop intros that change the stage colour behind a held hero.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same bars mask and layers as above, but every column is one flat colour: the next stage colour, or the accent if this is the film's one accent flood.
2. Alternative: alternate two adjacent lightness steps of one hue column to column (two plates, the mask on the second only), merging into a single tone as the field closes.
3. Never put a ramp inside a column: no gradient in either plate.

**Full look** (relies on gradient, orange, purple: only when the person's brand supplies that look):

1. A stepped mask: `make_transition_mask_tool {"pattern": "bars", "count": 14, "order": "centre"}` (staggered strips, 12-16 at 1920 px, outward from the column under the hero).
2. Stage layers: the old stage below, a plate of the next stage colour above it (`add_title_tool {"text": " ", "background_color": "#14181f", "position_seconds": <s>, "duration_seconds": 1.2, "track": 2}`), the hero above both (track 3, held with a living-hold creep `scale_x/scale_y` 1.0 to 1.03).
3. Reveal the plate through the bars: `add_transition_tool {"track": 2, "position_seconds": <s>, "duration_seconds": 0.9, "transition": "<mask name from the bin>"}` (use `update_transition_tool {"mask_file_id": "<mask>", "interpolation": "linear"}`); columns rise over 40 f (0.67 s) on a smooth ease with a 2 f (0.03 s) stagger per column outward, 7 steps for 14-15 columns, about 54 f (0.9 s) in all.
4. The field closes on a downbeat and swaps to one flat plate on that frame; hero answers with `scale_x/scale_y` `[{"seconds": <close>, "value": 1.0}, {"seconds": <close+0.033>, "value": 1.02}, {"seconds": <close+0.13>, "value": 1.0, "ease": "ease_out_expo"}]` (attack 2 f, tau 5 f).
5. A second copy of the hero in the opposite tone, masked to the union of the column rects, flips its tone exactly where a column stands behind it (`add_shape_mask_tool` per column or a polygon mask). `add_sfx_tool {"recipe": "riser_noise", "at_seconds": <s>, "gain_db": -16}` and `{"recipe": "impact_thud", "at_seconds": <close>, "gain_db": -8}`.

Fallback: The tone-flipped hero copy clipped to the column union needs a keyframed polygon mask; without it keep the hero a mid tone readable on both grounds.

## Timing & taste rules

- cinetic's timing (60 fps): Each column rises over 40 f (0.67 s) on ease_in_out_sine (tops peak at about 76 px/f at 1080p). Stagger 2 f (0.03 s) per column outward from the centre (7 steps for 14-15 columns), about 54 f (0.90 s) in all. The field closes on a downbeat and swaps to one flat plate on the same frame. Hero pulse: attack 2 f (0.03 s), tau 5 f (0.08 s).
- Each column rises over 40 f (0.67 s) on a smooth ease; tops peak at ~76 px/f at 1080p.
- Stagger 2 f (0.03 s) per column outward from the centre; about 54 f (0.9 s) in all.
- 12-16 columns at 1920 px, or the hero's own grid unit; no gutters.
- Closes on a downbeat and swaps to one flat plate on the same frame; hero pulse attack 2 f, decay 5 f (0.08 s).
- Once per film.

## Sound for it

A rising noise riser across the 54 f and a thud on the closing frame.

## Common mistakes

- Using it as a general scene change between unrelated shots (it reads as a preset blinds wipe), behind small readable type, or more than once per film (avoid_when).
- A visible gutter between columns.
- Fading the tone flip instead of switching it exactly where a column stands.
- Avoid when: As a general scene change between unrelated shots (it reads as a preset blinds wipe), behind small readable type, or more than once per film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-stepped-column-fill`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
