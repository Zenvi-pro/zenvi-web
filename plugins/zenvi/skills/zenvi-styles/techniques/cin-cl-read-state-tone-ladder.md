---
id: cin-cl-read-state-tone-ladder
kind: technique
summary: "When items build in order (captions, lists, steps): the one being read is white, read ones mid grey, next ones dim."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [orderly, legible, calm]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-word-rotator, cin-cl-mono-one-accent, cin-cl-ink-resolve]
avoid_with: [kinetic-word-pop, cin-cl-accent-on-newest]
needs: []
drawn: cinetic
---

# Now, was, next tone ladder

cinetic `cl-read-state-tone-ladder` · Colour and light · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Items in a sequence sit on three neutral tones: the one being read is at full ink, the ones already read step down to a mid grey and stay as context, and the ones still to come wait in a dim grey.

Use when: Captions that build in steps, lists and checklists that grow, slot rollers, status sequences, and flanking words that make way for a new focal word.

## Build it in Zenvi

1. For each item, three stacked title clips of the same text, font and size, tones on an ink stage: NOW `#ffffff`, WAS `#8a8a90`, NEXT `#3c3c40`. Example item 1: `add_title_tool {"text": "Upload your clips", "text_color": "#ffffff", "position_seconds": 1.0, "duration_seconds": 5, "screen_position": "center"}` plus the WAS and NEXT clips on the tracks below it.
2. Promote NEXT to NOW over 6 f (0.1 s) on the item's cue (here 1.0 s): `set_keyframes_tool {"timeline_clip_id": "<item1_now>", "property": "alpha", "points": [{"seconds": 0.9, "value": 0}, {"seconds": 1.0, "value": 1, "ease": "ease_out_expo"}, {"seconds": 2.2, "value": 1}, {"seconds": 2.37, "value": 0, "ease": "ease_in_out_sine"}]}`.
3. Demote on the next item's cue (2.2 s) over 10 f (0.17 s): the WAS clip does the opposite, `alpha` 0 to 1 at 2.2-2.37 s, so only one item is at full white after each handoff.
4. Items still to come sit at NEXT only when 'there is more' is the message, at most three visible. Exits go through WAS: an item drops to WAS before it leaves.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.0, "gain_db": -20}` per new NOW item at most.

Fallback: Three stacked titles per item is the only way to change a title's tone in time; keep the list to 5 items or fewer.

## Timing & taste rules

- cinetic's timing (60 fps): Promotion takes 6 f (0.10 s) on ease_in_out_cubic. Demotion takes 10 f (0.17 s) on ease_in_out_sine, starting with the next item's arrival. Each item holds NOW for at least 24 f (0.40 s). Rollers and ratchets step on the slot frame (0 f (0.00 s)). An exit starts at least 8 f (0.13 s) after the item reaches WAS. On ink, the tones sit at about 100% (NOW), 40% (WAS) and 24% (NEXT) of the way from the stage to white.
- Promotion takes 6 f (0.1 s); demotion 10 f (0.17 s, ease_in_out_sine), starting with the next item's arrival.
- Each item holds full ink at least 24 f (0.4 s).
- Rollers and ratchets step their tones on the slot frame, no tween.
- On ink, tones sit at about 100 % (now), 40 % (was) and 24 % (next) of the way from stage to white.
- Same weight and size for all items: tone alone carries the order. The accent stays out of the ladder.

## Sound for it

At most one barely-there tick per new item, or none; the tone shift is the cue.

## Common mistakes

- A single statement that lands all at once, or real product UI whose own text colours must stay true.
- Dropping an item straight from now to gone; go through the mid-grey step.
- In a lens list, ordering tone by reading order instead of distance from the focus line.
- Avoid when: A single statement that lands all at once, or real product UI whose own text colours must stay true. In lens lists, tone should follow distance from the focus line, not reading order.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-read-state-tone-ladder`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
