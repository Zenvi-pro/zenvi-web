---
id: cin-dn-tucked-unit-label
kind: technique
summary: "When a hero figure needs its unit without a second line: a small word tucks under the last digits."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_title_tool, set_keyframes_tool]
pace: calm
mood: [refined, compact]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-counter]
avoid_with: [big-number-lockup-and-counter]
needs: []
drawn: cinetic
---

# Tucked unit under the last digits

cinetic `dn-tucked-unit-label` · Data and numbers · accent · energy calm · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A small lowercase unit word fades in right-aligned under a big number's last digits, its top overlapping the numeral's baseline, so number and unit read as one mark.

Use when: A hero figure needs its unit (views, users, ms) without a second line pushing the layout down.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same counter and the same placement, but the unit uses the film's one sans (weight 450, muted or the stage's secondary ink): no second display typeface, no cream or gold tint.
2. Step 2-4 as above with `"text_color"` set to the secondary ink of the palette.

**Full look** (relies on serif, beige: only when the person's brand supplies that look):

1. `add_motion_block_tool {"block": "counter", "position_seconds": 1.0, "duration_seconds": 4.0, "placement": "full_frame", "params": {"values": ["12.4"], "decimals": 1, "style": "count", "align": "center", "weight": 800}}` (no label here; the unit is its own clip).
2. Unit word at 0.35x the numeral size, weight 450, muted ink: `add_title_tool {"text": "views", "template": "Standard_1", "text_color": "#8a8f98", "font_scale": 0.5, "position_seconds": 2.2, "duration_seconds": 2.8, "track": "5"}` (starts at least 12 f, 0.2 s, after the number settles; 36 f, 0.6 s, is a good default).
3. Tuck it: right edge to the numeral's right edge, its top at the numeral baseline minus 0.3x the label's line height, so it overlaps the last two digits: set a constant `set_keyframes_tool {"timeline_clip_id": "<unit>", "property": "location_x", "points": [{"seconds": 2.2, "value": <dx>}, {"seconds": 5.0, "value": <dx>}]}` and `location_y` the same, measured on `inspect_timeline_tool`.
4. Fade in over 19 f (0.32 s) with a 4 px rise: `alpha` 0 to 1 `ease_in_out_sine` and `location_y` +0.004 to the tucked value.

## Timing & taste rules

- cinetic's timing (60 fps): Starts at least 12 f (0.20 s) after the number settles (36 f (0.60 s) is a good default). Opacity over 19 f (0.32 s) on ease_in_out_sine with a 4 px rise via arrive. Label at 0.35x the numeral size, overlapping its baseline by 30% of the label height.
- Unit at 0.35x the numeral size, overlapping the baseline by 30 % of the label height, right-aligned to the figure.
- Starts 12-36 f (0.2-0.6 s) after the number settles so the figure reads first.
- Fade 19 f (0.32 s) smooth with a 4 px rise; then hold with the number under the shot's breath.
- One short lowercase word only.

## Sound for it

None; it is a quiet addendum to the count.

## Common mistakes

- A unit longer than one short word.
- Numbers ending in narrow digits (1, 7) that leave no room to tuck under.
- Starting the unit before the figure has settled.
- Avoid when: The unit is longer than one short word; numbers ending in narrow digits (1, 7) that leave no room to tuck under.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-tucked-unit-label`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
