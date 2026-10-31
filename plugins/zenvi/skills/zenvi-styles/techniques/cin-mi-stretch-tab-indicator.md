---
id: cin-mi-stretch-tab-indicator
kind: technique
summary: "When a tab or filter switch drives the next state, the pill shoots over, stretches mid-travel, then hugs the new label."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [elastic, weighty, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-hard-swap-on-cause, cin-mi-shared-highlight-walk, cin-mi-guide-cursor-hover-press]
avoid_with: [cin-mi-velocity-stretch-dot]
needs: []
drawn: cinetic
---

# Stretchy tab indicator

cinetic `mi-stretch-tab-indicator` · Micro-interaction · signature · energy medium · formats feature, walkthrough, loop, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The selected pill of a segmented control shoots to the new option with its leading edge arriving first, stretches to about 1.9x its width mid-travel, then hugs the new label as the label takes the active colour.

Use when: A tab, filter or toggle switch causes the next state (the chart changes, the list swaps) and deserves weight.

## Build it in Zenvi

1. Indicator: `add_title_tool {"text": " ", "background_color": "<ink_or_white>", "fit_text": false, "position_seconds": 0.0, "duration_seconds": 4.0, "track": "2"}` behind the labels (a screenshot or per-label title clips); `corner_radius` fully round, fill flat, height fixed.
2. Two edges, one ease, different lengths: leading edge reaches the target edge in 12 f (0.2 s), trailing edge in 20 f (0.33 s), both `ease_in_out_sine`. Sample both edges every 2 f (0.03 s) and write the indicator's centre and width: `set_keyframes_tool {"timeline_clip_id": "<pill>", "property": "location_x", "interpolation": "linear", "points": [...centre = (L+R)/2...]}` and `scale_x` points = (R - L) / start_width, which swells to about 1.9x near f6 (0.1 s) and relaxes to the target width.
3. For hops beyond about 250 px keep the 0.6 ratio but lengthen both (a 420 px hop takes 18 f / 30 f = 0.3 s / 0.5 s) so the leading edge stays under about 65 px/f.
4. Labels: the new label goes from grey to the active colour over the last 8 f (0.13 s), the old one back over the first 8 f (two crossfading title clips each); step the new label's weight 500 to 600 on the landing frame.
5. Calm variant: the fill fades to a 1.5 px ring over the first 6 f (0.1 s), the ring swells to 1.35x by 30 % of the travel and shrinks onto the target over 48 f (0.8 s) `ease_in_out_sine`, then the solid fill snaps back over 4 f (0.07 s).
6. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <landing>, "gain_db": -22}` on the landing frame.

## Timing & taste rules

- cinetic's timing (60 fps): Leading edge 12 f (0.20 s), trailing edge 20 f (0.33 s), both ease_out_cubic, for hops up to about 250 px. For longer hops keep the 0.6 ratio and lengthen both so the leading edge stays under about 65 px/f (a 420 px hop takes 18 f (0.30 s) / 30 f (0.50 s)). Label colour 8 f (0.13 s). Calm variant: 48 f (0.80 s) ease_in_out_sine, 6 f (0.10 s) fill fade, 4 f (0.07 s) snap.
- Leading edge 12 f (0.2 s), trailing edge 20 f (0.33 s), same ease, hops up to about 250 px; width swells to about 1.9x near f6 (0.1 s).
- Longer hops: keep the 0.6 ratio and lengthen both (420 px takes 18 f / 30 f = 0.3 s / 0.5 s), leading edge under 65 px/f.
- Label colour 8 f (0.13 s); weight step on the landing frame.
- Fixed height, flat fill, radius height / 2.

## Sound for it

A ui_tap at -22 dB on the landing frame; nothing during the stretch.

## Common mistakes

- More than about five options in a tight row: the stretch overlaps its neighbours.
- An indicator that only reads with refraction or a frosted backdrop behind it.
- Moving both edges with the same duration: the stretch is what makes it feel physical.
- Avoid when: The control has more than about five options in a tight row (the stretch overlaps its neighbours), or the indicator would only read with refraction or a frosted backdrop behind it.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-stretch-tab-indicator`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
