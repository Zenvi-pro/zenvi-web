---
id: cin-mi-drag-lift-seat
kind: technique
summary: "When a drag causes the next state, the item lifts, follows with a slight lag and tilt, then seats with a squash."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, copy_clip_keyframes_tool, add_sfx_tool, add_emoji_tool]
pace: medium
mood: [tactile, weighty, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-drag-reorder-makeway, cin-pd-drag-assets-skeleton-fill, cin-mi-guide-cursor-hover-press]
avoid_with: [kcut-hit-fx]
needs: []
drawn: cinetic
---

# Drag, lift and seat

cinetic `mi-drag-lift-seat` · Micro-interaction · workhorse · energy medium · formats walkthrough, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A chip or file picked up by the cursor lifts off the surface, follows the hand with a slight lag and tilt, then drops into its slot with a small contact squash as the slot accepts it.

Use when: A drag-and-drop (attach a file, add an integration, reorder a card) causes the next state.

## Build it in Zenvi

1. The item (a chip or file), the slot and the pointer are separate clips: `add_clip_to_timeline_tool {"file_id": "<chip>", "position_seconds": 0.0, "duration_seconds": 3.0, "track": "3"}`.
2. Grab: scale 1 to 1.04 over 8 f (0.13 s) on `ease_out_expo` and deepen the shadow (a soft dark clip behind it, alpha 0.06 to 0.18): `set_keyframes_tool {"timeline_clip_id": "<chip>", "property": "scale_x", "points": [{"seconds": <grab>, "value": 1.0}, {"seconds": <grab+0.13>, "value": 1.04, "ease": "ease_out_expo"}]}` (same for scale_y).
3. Drag: give the chip the pointer's `location_x`/`location_y` path delayed by 3 f (0.05 s); `copy_clip_keyframes_tool {"source_clip_id": "<pointer>", "timeline_clip_ids": ["<chip>"], "timing": "offset"}` then shift it. Tilt `rotation` = clamp(horizontal speed x 0.25, -6, 6) degrees, sampled every 4 f (0.07 s).
4. Entering the slot: its outline thickens 1 to 2 px and tints over 6 f (0.1 s) on `ease_in_out_sine` (an outline clip's `scale`/`alpha`).
5. Release: the last 40-80 px into the slot over 8 f (0.13 s) on `ease_in_cubic` (contact); scale and shadow settle back; squash `scale_y` 0.94 and `scale_x` 1.04 for about 8 f (0.13 s) anchored at the contact edge (`origin_y` at the bottom).
6. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <contact>, "gain_db": -18}` on the contact frame.

## Timing & taste rules

- cinetic's timing (60 fps): Lift 8 f (0.13 s) ease_out_expo to 1.04 with a 16/32 px shadow. Follow lag 3 f (0.05 s); tilt at most 6 degrees. Slot tint 6 f (0.10 s) ease_in_out_cubic. Drop 8 f (0.13 s) ease_in_cubic, plus squash over about 8 f (0.13 s).
- Lift 8 f (0.13 s) to 1.04 with a shadow from about 2/4 px to 16/32 px at 18 % black.
- Follow lag 3 f (0.05 s); tilt at most 6 degrees.
- Slot tint 6 f (0.1 s); drop 8 f (0.13 s) on an ease-in; squash over about 8 f (0.13 s).
- Keep the drag under about 600 px, or cut it.

## Sound for it

A snap or ui_tap at -18 dB on the contact frame; the lift is silent.

## Common mistakes

- A drag path over about 600 px: cut it.
- An item with text that must be read while it tilts.
- A drop with a bounce: the slot should accept it with a small squash only.
- Avoid when: The drag path is long (over about 600 px, cut it), or the item contains text that must be read while it tilts.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-drag-lift-seat`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
