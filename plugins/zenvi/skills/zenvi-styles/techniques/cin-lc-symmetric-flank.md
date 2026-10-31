---
id: cin-lc-symmetric-flank
kind: technique
summary: "When a narrow centre object needs company: mirrored caption halves or mirrored item columns flank it on both sides."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_motion_block_tool, add_title_tool, set_keyframes_tool]
pace: medium
mood: [balanced, tidy, framed]
aspect: ["16:9", "1:1"]
pairs_with: [cin-lc-gap-open-insert, kinetic-quote-card, t061]
avoid_with: [cin-lc-vertical-band-stack, cin-lc-one-centred-subject]
needs: []
drawn: cinetic
---

# Centre object with mirrored flanks

cinetic `lc-symmetric-flank` · Layout and composition · accent · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A narrow centre object (a phone-width window, a pill, a big number) holds the middle while matching elements sit on both sides: the two halves of a caption, or two mirrored columns of items.

Use when: A narrow device or pill leaves empty sides; a stat that needs visible volume on either side; inputs and outputs around one product; the tagline that frames a logo pill before the end.

## Build it in Zenvi

1. Centre object (phone window, pill, big number) on the frame centre: `add_clip_to_timeline_tool {"file_id": "<centre>", "position_seconds": 0, "duration_seconds": 3, "track": 2}` or `add_motion_block_tool {"block": "counter", "position_seconds": 0, "duration_seconds": 3, "params": {"values": ["2400"], "label": "teams"}}`.
2. Caption halves, a 3 % gutter (0.03) each side of the object: `add_title_tool {"template": "Standard_1", "text": "Built for", "position_seconds": 0.4, "duration_seconds": 2.6, "fade_in_seconds": 0.33, "track": 3}` set right-aligned with `set_keyframes_tool` `location_x` -0.3, and the right half `"text": "everyone"` at `location_x` +0.3, starting 20-42 f (0.33-0.7 s) after the left (so 0.73-1.1 s).
3. Column version: two columns of 80 px items, rows offset by half a row, the right column the mirror of the left; rows in sync top to bottom, 6 f (0.1 s) per row: `set_keyframes_tool {"timeline_clip_id": "<row_i>", "property": "alpha", "mode": "replace", "points": [{"seconds": "<0.1*i>", "value": 0}, {"seconds": "<0.1*i+0.2>", "value": 1, "ease": "ease_out_expo"}]}` plus a 10 px (0.009) `location_y` rise.
4. Outward drift: both columns `location_x` away from the centre 3.8, then 0.7, then 1.8 px/f over about 120 f (2 s), centre numeral rising 50 px (0.046) over 38 f (0.63 s) with `ease_out_expo`.

## Timing & taste rules

- cinetic's timing (60 fps): Caption halves 20-42 f (0.70 s) apart; hold about 60 f (1.00 s). Column rows 6 f (0.10 s) apart (five rows in about 30 f (0.50 s)); outward drift 3.8, then 0.7, then 1.8 px/f over about 120 f (2.00 s). Centre numeral rises 50 px over 38 f (0.63 s).
- Caption halves 20-42 f (0.33-0.7 s) apart; hold about 60 f (1.0 s).
- Column rows 6 f (0.1 s) apart, five rows in about 30 f (0.5 s); drift 3.8, 0.7, 1.8 px/f over about 120 f (2 s).
- Centre numeral rises 50 px (0.046 of the height) over 38 f (0.63 s) on ease_out_expo.
- 3 % gutter (58 px at 1080p) between each flank and the object.

## Sound for it

A single soft pop (-14 dB) as the right half lands; columns are silent.

## Common mistakes

- A wide centre subject: each flank gets squeezed under 20 % of the frame.
- Vertical formats: stack above and below instead.
- Mirrored halves that start together: the right half follows the left.
- Avoid when: Wide centre subjects (each flank gets squeezed under 20% of the frame), or vertical formats (stack above and below instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-symmetric-flank`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
