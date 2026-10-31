---
id: cin-lc-icon-ragged-stack
kind: technique
summary: "When three or four abilities need a list without bullets: a lead word, then keywords with icons on a staggered rag."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_clip_to_timeline_tool, add_sfx_tool]
pace: medium
mood: [modern, tidy, editorial]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-lc-opposite-corner-relay, kinetic-mask-reveal, shot-blur-slide]
avoid_with: [kinetic-word-pop, kcut-strobe-cards]
needs: []
drawn: cinetic
---

# Icon-led ragged word stack

cinetic `lc-icon-ragged-stack` · Layout and composition · accent · energy medium · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A short lead word is followed by three or four keywords on separate lines, each with a small line icon, set at staggered x positions so the list has a rag instead of bullets.

Use when: Listing three or four abstract capabilities, platforms or audiences that would otherwise be a bullet list; a 'works across X, Y, Z' beat.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Drop the muted lead word above the stack. Fold it into row one at full strength and the keywords' size: `add_title_tool {"template": "Standard_1", "text": "Built for teams", "text_color": "#161616", "position_seconds": 0, "duration_seconds": 3.4, "track": 4}`, then `agencies` and `founders` on the rag.
2. Icons only where the person supplies the product's own mark for that item (`add_clip_to_timeline_tool`); otherwise words alone on the rag.
3. Keep the rag table (`location_x` 0, +0.0625, -0.031), the 10 f (0.17 s) row stagger with `ease_out_expo` and the 0.4 px/f drift (`location_y` -0.022 per second).

**Full look** (relies on filler-text: only when the person's brand supplies that look):

1. Lead word: `add_title_tool {"template": "Standard_1", "text": "Built for", "text_color": "#8a8a8a", "position_seconds": 0, "duration_seconds": 3.4, "track": 3, "fade_in_seconds": 0.3}`; park it above the stack with `set_keyframes_tool` on `location_y`.
2. One title per keyword, rows 10 f (0.17 s) apart: `add_title_tool {"template": "Standard_1", "text": "Teams", "text_color": "#161616", "position_seconds": 0.17, "duration_seconds": 3.2, "track": 4}` and again for rows 2-4 at 0.33, 0.5, 0.67 s on tracks 5-7. Rag: `location_x` offsets from the table [0, +120, -60, +180] px, which is [0, 0.0625, -0.031, 0.094] of the frame width.
3. One icon clip per row (the product's own mark for that item) at one em, left of the word: `add_clip_to_timeline_tool {"file_id": "<icon_i>", "position_seconds": 0.17, "duration_seconds": 3.2, "track": 8}`.
4. Entry per row (title and icon share keyframes): `set_keyframes_tool {"timeline_clip_id": "<row_i>", "property": "location_y", "mode": "merge", "points": [{"seconds": 0.17, "value": "<y_i + 0.011>"}, {"seconds": 0.54, "value": "<y_i>", "ease": "ease_out_expo"}]}` and `alpha` 0 to 1 over the same 22 f (0.37 s).
5. Hold: drift the whole stack up at 0.4 px/f, which is `location_y` -0.022 over 1 s, from 0.54 s to 2.4 s; exit in reading order 4 f (0.07 s) apart with `alpha` to 0 over 0.2 s.
6. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 0.17, "gain_db": -18}` on the first row only.

Fallback: No per-line mask rise exists on title clips; use alpha plus the 12 px rise.

## Timing & taste rules

- cinetic's timing (60 fps): Rows 8-12 f (0.20 s) apart (10 by default), 22 f (0.37 s) each on ease_out_expo, 12 px rise. Hold the full stack 60-80 f (1.33 s) with the drift, then exit in reading order 4 f (0.07 s) apart.
- Rows 8-12 f apart (10 f, 0.17 s default), 22 f (0.37 s) each on ease_out_expo, 12 px (0.011) rise.
- Hold the full stack 60-80 f (1.0-1.3 s) with the 0.4 px/f drift; exit in reading order 4 f (0.07 s) apart.
- Maximum four items, each at most two words; keywords at secondary-type size or larger.
- Icon stroke weight matches the type's stems and uses the text colour.
- Stagger the x positions so the list has a rag; do not left-align it.

## Sound for it

One quiet ui_tap on the first row at most; never a sound per row.

## Common mistakes

- More than four items or items longer than two words: it becomes a bullet list.
- Decorative stock icons: use the product's own marks or drop the icons and keep the rag.
- Starting all rows together: the 10 f stagger is the rhythm.
- Avoid when: More than four items, items longer than two words, or icons that decorate rather than mean something (then drop them and keep the rag).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-icon-ragged-stack`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
