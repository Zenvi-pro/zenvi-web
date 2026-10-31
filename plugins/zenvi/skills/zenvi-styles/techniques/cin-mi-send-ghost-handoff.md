---
id: cin-mi-send-ghost-handoff
kind: technique
summary: "When a message is sent, the composer text drifts up and fades as the posted bubble appears above, instead of flying."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_effect_tool, update_effect_tool, add_sfx_tool]
pace: calm
mood: [quiet, clean, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-fast-prompt-true-scale, cin-pd-agent-status-then-answer, prompt-bar-typing-hero]
avoid_with: [cin-ui-discard-into-bin, shot-glitch-tear-cut]
needs: []
drawn: cinetic
---

# Send as a ghosted handoff

cinetic `mi-send-ghost-handoff` · Micro-interaction · workhorse · energy calm · formats feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

On send, the composer's text drifts up and fades away while the same content appears above as a posted message, briefly overlapping the old text, instead of flying between containers.

Use when: A message, prompt or post is submitted and the result appears elsewhere in the same frame; this is calmer and cheaper than a flight.

## Build it in Zenvi

1. Quickest: `add_motion_block_tool {"block": "chat_thread", "params": {"messages": ["<question>"], "assistant": "<reply>", "placeholder": "<placeholder>"}, "position_seconds": 0.0, "duration_seconds": 8.0}` (the question types into the composer and is sent up as a bubble, typing dots answer).
2. Own layers: composer text and bubble are separate clips. From the send press, the composer text fades over 12 f (0.2 s): `set_keyframes_tool {"timeline_clip_id": "<composer_text>", "property": "alpha", "points": [{"seconds": <send>, "value": 1}, {"seconds": <send+0.2>, "value": 0, "ease": "ease_in_out_sine"}]}` plus `location_y` 0 to -0.011 (12 px), and a Blur effect of 0 to 4 px over the same window (`add_effect_tool` + `update_effect_tool`) so it softens only once it is moving.
3. 4 f (0.07 s) after the press the posted bubble comes in at its final place over 18 f (0.3 s): `alpha` 0 to 1 on `ease_in_out_sine` and `location_y` +0.011 to 0 on `ease_out_expo`. There is 8 f (0.13 s) of overlap.
4. Empty the composer on frame +12 (0.2 s) and bring its placeholder back over 8 f (0.13 s). Pair it with the press on the send button (a 4 f / 0.07 s dip then 8 f / 0.13 s recoil).
5. `add_sfx_tool {"recipe": "notification_blip", "at_seconds": <send + 0.07>, "gain_db": -22}`.

## Timing & taste rules

- cinetic's timing (60 fps): Composer out over 12 f (0.20 s) ease_in_out_sine (-12 px, blur up to 4 px). Bubble in over 18 f (0.30 s) from +4 f (12 to 0 px, ease_out_expo with arrive). 8 f (0.13 s) of overlap; placeholder back over 8 f (0.13 s).
- Composer out over 12 f (0.2 s), 12 px rise and up to 4 px blur; bubble in over 18 f (0.3 s) from +4 f (0.07 s), 12 px to 0.
- 8 f (0.13 s) of overlap between old and new; placeholder back over 8 f (0.13 s).
- No flight between containers: it is calmer and cheaper.
- Press envelope on the send button first.

## Sound for it

One notification_blip at -22 dB as the bubble lands; the composer fade is silent.

## Common mistakes

- The journey itself is the point: then show the flight.
- Using the ghost handoff as a transition between shots, where a crossfade is never the default.
- Blurring from the first frame: the text should soften only as it moves.
- Avoid when: The journey itself is the point (show the flight), or the move would serve as a transition between shots, where a crossfade is never the default.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-send-ghost-handoff`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
