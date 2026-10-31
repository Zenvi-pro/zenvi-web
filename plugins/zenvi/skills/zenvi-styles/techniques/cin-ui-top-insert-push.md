---
id: cin-ui-top-insert-push
kind: technique
summary: "When results keep arriving, each new item drops in at the top and pushes the older ones down one slot, on a steady beat."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool, add_clip_to_timeline_tool]
pace: medium
mood: [abundant, rhythmic, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-row-cascade, cin-pd-agent-status-then-answer, shot-stack-press-count]
avoid_with: [cin-ui-card-grid-arrival]
needs: []
drawn: cinetic
---

# Top insert pushes the list down

cinetic `ui-top-insert-push` · UI choreography · workhorse · energy medium · formats launch, feature, loop, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

New items arrive at the top of a list one at a time and every earlier item slides down one slot, on a steady metronome that reads as abundance or on a slower cadence where each row resolves as it is generated.

Use when: Results, messages, subtasks or saved items accumulating: generated rows, imports landing, a feed or a stack filling up.

## Build it in Zenvi

1. Quickest: `add_motion_block_tool {"block": "notification_stack", "params": {"items": ["<a>", "<b>", "<c>", "<d>"], "style": "dm", "highlight_last": true}, "position_seconds": 0.0, "duration_seconds": 5.0}` (each new card lands on top and pushes older ones down).
2. Your own rows: one clip per item. Metronome: one insert every 14 f (0.23 s), earlier rows slide down one pitch (0.143 of height for 155 px) over 20 f (0.33 s) `ease_in_out_sine`: `set_keyframes_tool {"timeline_clip_id": "<row_k>", "property": "location_y", "mode": "merge", "points": [{"seconds": <insert_j>, "value": <y>}, {"seconds": <insert_j+0.33>, "value": <y+0.143>, "ease": "ease_in_out_sine"}]}` for every later insert j; overlapping pushes add.
3. New pill reveal left to right over 12 f (0.2 s): `scale_x` 0.6 to 1 with `origin_x` 0 and `alpha`; its icon leads, label fades in 4 f (0.07 s) later.
4. Generation cadence instead: one insert every 36-40 f (0.6-0.67 s), the row starts at scale_x 0.6 about its left edge and resolves over 12 f (0.2 s) `ease_out_expo`, rows below move 66 px (0.061) over 10 f (0.17 s).
5. Camera drift on the group: `set_keyframes_tool {"property": "location_y", "points": [...]}` easing 19 px/f down to 3 px/f over 90 f (1.5 s). `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <insert_j>, "gain_db": -24}` per insert.

## Timing & taste rules

- cinetic's timing (60 fps): Metronome: every 14 f (0.23 s), push 155 px over 20 f (0.33 s) (ease_in_out_cubic), pill reveal 12 f (0.20 s) (ease_in_out_cubic), label +4 f (0.07 s), camera drift 19 to 3 px/f (x0.97 per frame). Generation: every 36-40 f (0.67 s), resolve 12 f (0.20 s) (ease_out_expo) from scaleX 0.6 and 6 px blur, push 66 px over 10 f (0.17 s) (ease_in_out_cubic).
- Metronome: one insert every 14 f (0.23 s), 155 px pitch pushed over 20 f (0.33 s), about 21 px/f.
- Generation cadence: every 36-40 f (0.6-0.67 s), resolve 12 f (0.2 s), push 66 px over 10 f (0.17 s).
- Camera drift decays from about 19 to 3 px/f over 90 f (1.5 s).
- Keep to about 6 inserts in view.

## Sound for it

A tick on every insert frame so the cadence is heard, level steady (-24 dB) for a metronome, rising 1 dB per insert for a generation run.

## Common mistakes

- The whole list should appear at once: use a row cascade.
- So many inserts that the pushes blur into noise: scroll instead.
- A different push time per row: they must share one curve or the list shimmers.
- Avoid when: The whole list should appear at once (row cascade), or there are so many inserts that the pushes blur into noise (scroll instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-top-insert-push`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
