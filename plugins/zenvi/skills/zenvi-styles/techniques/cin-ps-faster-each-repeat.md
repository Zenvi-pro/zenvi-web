---
id: cin-ps-faster-each-repeat
kind: technique
summary: "When an action repeats: the first runs at full length, the second about 40 % faster, later ones ratchet or are implied."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [duplicate_clips_tool, set_clip_speed_tool, move_clips_tool, add_kinetic_title_tool, automate_volume_tool, add_sfx_tool]
pace: fast
mood: [rhythmic, learnable, crisp]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [accelerating-cut-length-ramp, shot-stack-press-count, cin-ps-fixed-ask-variable-answer]
avoid_with: [cin-ps-one-long-hold]
needs: []
drawn: cinetic
---

# Each repeat runs faster

cinetic `ps-faster-each-repeat` · Pacing and structure · workhorse · energy medium · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The first instance of a repeated action plays at full length, the second runs about 40% quicker, and later ones are implied or ratchet faster still.

Use when: Repeated unlocks, card reveals, list items, word deletes, and captions that recur across a film.

## Build it in Zenvi

1. First instance at full length, for example a card reveal of 0.2 s rise, 1.4 s total: place the clip and its keyframes.
2. Second instance at 0.6x the length, starting about 46 f (0.77 s) after the first: `duplicate_clips_tool {"timeline_clip_ids": ["<first>"], "position_seconds": 3.0}` then `set_clip_speed_tool {"clip_query": "<second>", "speed": 1.67}` (a rise of 12 f becomes 7 f, same curve compressed, so an ease_out stays ease_out).
3. Show two full instances, then cut away or batch the rest. For lists and deletes, schedule starts from shrinking gaps: 26, 14, 12, 8, 8, 4, 4 f = 0.43, 0.23, 0.2, 0.13, 0.13, 0.07, 0.07 s, with `move_clips_tool {"clip_query": "<item_n>", "position_seconds": ...}`.
4. Across the film, caption word stagger falls the same way: `add_kinetic_title_tool {"text": "<title>", "stagger_seconds": 0.4}` (24 f) down to `0.083` (5 f) on late captions.
5. One low pad swell under the run with attack 6-9 f (0.1-0.15 s), release about 84 f (1.4 s): `automate_volume_tool {"role": "music", "shape": "swell", "start_seconds": 3.0, "end_seconds": 6.5, "db": 2}`, and one tick per step growing by about 1 dB: `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 3.0, "gain_db": -20}` then -19, -18, ...

## Timing & taste rules

- cinetic's timing (60 fps): Second instance at 0.6x length (for example a rise of 12 f (0.20 s) becomes 7 f (0.12 s)), starting about 46 f (0.77 s) after the first. Ratchet gaps 26, 14, 12, 8, 8, 4, 4 f (0.07 s). Caption word stagger falling from 24 f (0.40 s) on the title to 5 f (0.08 s) on late captions.
- Duration k = max(minimum, base x 0.6^k); second instance at 0.6x length, starting about 46 f (0.77 s) after the first.
- Ratchet gaps 26, 14, 12, 8, 8, 4, 4 f (0.43, 0.23, 0.2, 0.13, 0.13, 0.07, 0.07 s).
- Caption word stagger falls from 24 f (0.4 s) on the title to 5 f (0.08 s) on late captions.
- Pad swell: attack 6-9 f (0.1-0.15 s), release about 84 f (1.4 s); ticks climb about 1 dB each step.

## Sound for it

A tick per step, each about 1 dB louder than the last, on a swelling pad; none on the implied repeats.

## Common mistakes

- Items that each need a full read: do not compress them.
- Speeding the first instance: it must teach the pattern at full length.
- A different curve on the fast instance: it is the same curve compressed.
- Avoid when: Items that each need a full read, and the first instance, which must teach the pattern at full length.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-faster-each-repeat`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
