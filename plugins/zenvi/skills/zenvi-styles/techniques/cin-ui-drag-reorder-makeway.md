---
id: cin-ui-drag-reorder-makeway
kind: technique
summary: "When ordering is the smart part, an item lifts, drags on a slight arc and neighbours slide aside to make room."
categories: [cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_emoji_tool, set_keyframes_tool, add_sfx_tool, add_clip_to_timeline_tool]
pace: calm
mood: [smooth, deliberate, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-drag-lift-seat, cin-ui-push-aside-reflow, cin-mi-guide-cursor-hover-press]
avoid_with: [cin-ui-clutter-pileup-strip, kcut-hit-fx]
needs: []
drawn: cinetic
---

# Drag to reorder, siblings make way

cinetic `ui-drag-reorder-makeway` · UI choreography · workhorse · energy calm · formats walkthrough, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

An item lifts under the cursor, travels on a slight arc to a new position while its neighbours slide aside one slot at a time, and settles into place with a firm landing and no bounce.

Use when: Prioritising, scheduling, kanban boards, playlists: any product whose smart part is ordering things.

## Build it in Zenvi

1. List rows are separate clips; the dragged row on the top track, the pointer a clip: `add_emoji_tool {"emoji": "backhand index pointing up", "size": 0.06, "position_seconds": 0.0, "duration_seconds": 4.0, "track": "9"}`.
2. Lift on the press: scale 1 to 1.03 over 8 f (0.13 s) `ease_in_out_sine` and shadow up (a soft dark clip behind it, alpha 0.08 to 0.14).
3. Drag: `T = max(36 f, 0.15 x distance) f` = at least 0.6 s on `ease_in_out_sine`, with a 0.15 bow (an arc, not a line): sample `location_x`/`location_y` every 6 f (0.1 s) with `interpolation: "linear"`. Never above 20 px/f so the label stays readable. `rotation` = -0.15 degrees per px/f of horizontal speed, clamped to +-4.
4. Each time the hovered index changes, the displaced sibling moves one pitch over 12 f (0.2 s) `ease_in_out_sine`: `set_keyframes_tool {"timeline_clip_id": "<sibling>", "property": "location_y", "points": [{"seconds": <idx_change>, "value": <y>}, {"seconds": <idx_change+0.2>, "value": <y+pitch>, "ease": "ease_in_out_sine"}]}`.
5. Release: settle into the slot on `ease_out_cubic` with no bounce, lift reverses over 10 f (0.17 s), the marker flashes accent and relaxes over 24 f (0.4 s). `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <drop>, "gain_db": -20}`.

## Timing & taste rules

- cinetic's timing (60 fps): Lift 8 f (0.13 s) (ease_in_out_cubic), scale 1.03. Drag T = max(36, 0.15 x distance) f (ease_out_cubic) on a 0.15 bow, <= 20 px/f, tilt <= 4 deg. Sibling shift 12 f (0.20 s) (ease_in_out_cubic) per index change. Drop ease_out_quart, shadow back over 10 f (0.17 s), accent relax 24 f (0.40 s).
- Lift 8 f (0.13 s) to scale 1.03; shadow 8 percent to 14 percent.
- Drag T = max(36 f, 0.15 x distance) f (at least 0.6 s) on ease_in_out_sine with a 0.15 bow, 20 px/f or less, tilt at most 4 degrees.
- Sibling shift 12 f (0.2 s) per index change; firm drop, no bounce, accent relax 24 f (0.4 s).
- No more than 2-3 drags in one shot.

## Sound for it

One ui_tap at -20 dB on the drop frame; a very soft mouse_click at -26 dB on the grab.

## Common mistakes

- The reorder is automatic: animate the computed reorder on one curve with no cursor.
- More than 2-3 drags in one shot: it becomes a tutorial.
- A bounce on the drop: the landing should be firm and quiet.
- Avoid when: The reorder is automatic (animate the computed reorder on one curve, with no cursor), or more than 2-3 drags would fall in one shot.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-drag-reorder-makeway`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
