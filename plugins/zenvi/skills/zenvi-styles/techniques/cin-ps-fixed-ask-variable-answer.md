---
id: cin-ps-fixed-ask-variable-answer
kind: technique
summary: "When a demo repeats a request and result: a fixed 6-beat ask, then answers of varying length, one 2-3x longer."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [rhythmic, product-led, learnable]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [prompt-bar-typing-hero, cin-ps-faster-each-repeat, shot-type-and-filter]
avoid_with: [cin-ps-one-long-hold, shot-blur-slide]
needs: []
drawn: cinetic
---

# Fixed-length ask, variable answer

cinetic `ps-fixed-ask-variable-answer` · Pacing and structure · workhorse · energy medium · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A demo repeats a fixed-length ask beat followed by a result whose length varies with its importance, so the rhythm teaches itself and the variations prevent fatigue.

Use when: Prompt-to-result products, feature tours with one repeated action, and walkthroughs of 3-6 capabilities.

## Build it in Zenvi

1. The ask beat is one fixed-length unit, 6 beats (180 f at 120 BPM, 3.0 s): `add_motion_block_tool {"block": "prompt_bar", "position_seconds": 0, "duration_seconds": 3.0, "params": {"prompt": "<request>", "cursor": true}, "placement": "over_video"}`. Typing takes 68 f (1.13 s) however long the prompt, so shorten or lengthen the prompt, not the beat; first word pre-filled.
2. Beats inside it: icon drop 28 f (0.47 s), chip morph 16-20 f (0.27-0.33 s), cursor travel 14 f (0.23 s), press 32-40 f (0.53-0.67 s), a plus-to-x rotation of 8-12 f (0.13-0.2 s) as the cut cue.
3. Results, 4-8 beats (2-4 s) each, placed back to back after each ask: `add_clip_to_timeline_tool {"file_id": "<result_i>", "position_seconds": 3.0, "duration_seconds": 3.0, "track": 1}`; one hero result runs 2-3x the others (about 8 s).
4. From the third cycle on, split the ask into a big-type or 3-4x close-up insert plus the card: `set_keyframes_tool {"timeline_clip_id": "<ask_3>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 12.0, "value": 1.0}, {"seconds": 12.4, "value": 3.5, "ease": "ease_out_expo"}]}`.
5. `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 0.5, "gain_db": -18}` for typing and `{"recipe": "mouse_click", "at_seconds": 2.0}` at the press.

## Timing & taste rules

- cinetic's timing (60 fps): Ask beat 180-188 f (6 beats); results 138-234 f (3.90 s), the hero result about 490 f (8.17 s); 4-5 cycles; close-up insert from cycle 3.
- Ask beat 180-188 f (3.0-3.13 s, 6 beats); typing 68 f (1.13 s); icon drop 28 f; chip morph 16-20 f; cursor 14 f; press 32-40 f; plus-to-x 8-12 f.
- Results 138-234 f (2.3-3.9 s), the hero result about 490 f (8.2 s); 4-5 cycles.
- Close-up insert from cycle 3: the template stays, the framing changes.
- The ask never changes length so the viewer learns the beat.

## Sound for it

Typing foley and a click on each ask, always on the same beats; the results get one soft pop each, the hero result a bigger hit.

## Common mistakes

- Fewer than 3 instances: there is no pattern to learn.
- Stings: no room for repeats.
- Letting the ask beat vary: that is the one fixed thing.
- Avoid when: Fewer than 3 instances (there is no pattern to learn), and stings.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-fixed-ask-variable-answer`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
