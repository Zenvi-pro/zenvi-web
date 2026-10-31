---
id: cin-pd-fast-prompt-true-scale
kind: technique
summary: "When the input is the story, a real long prompt types in about a second at readable size, then is sent up as a bubble."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, inspect_timeline_tool, update_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [honest, fast, AI product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [prompt-bar-typing-hero, cin-pd-agent-status-then-answer, cin-pd-headline-becomes-input]
avoid_with: [kinetic-typewriter, shot-type-and-filter]
needs: []
drawn: cinetic
---

# Fast prompt at true scale

cinetic `pd-fast-prompt-true-scale` · Product demo · workhorse · energy medium · formats launch, feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The real prompt bar fills with a long, honest instruction in about a second at full legible size, the card growing as lines wrap, then the text is sent up into a chat bubble.

Use when: An AI, search or command product whose real input is the story; showing a real task without a dull typing wait.

## Build it in Zenvi

1. `add_motion_block_tool {"block": "prompt_bar", "params": {"prompt": "<honest prompt under 100 characters>", "cursor": true, "position": "center"}, "position_seconds": 0.0, "duration_seconds": 4.0}`; check with `inspect_timeline_tool` that the typing finishes in about 68 f (1.13 s), otherwise shorten the prompt or `update_motion_block_tool {"file_id": "<bar>", "duration_seconds": 3.0}`.
2. Pre-fill the first word so frame 1 already shows text; the newest 3 characters draw at 30 / 60 / 85 % opacity, each arriving in the accent and relaxing to ink over 12 f (0.2 s).
3. The card grows from the text: width 67 to 77 % of the frame over the first 24 f (0.4 s), then one line height over 12 f (0.2 s) on `ease_out_expo` at each wrap: `set_keyframes_tool {"timeline_clip_id": "<bar>", "property": "scale_x", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 0.4, "value": 1.15, "ease": "ease_out_expo"}]}`.
4. Keep the shot alive with a 2.5 % breath: `scale_x`/`scale_y` 1.0 to 1.025 on `ease_in_out_sine` across the shot. The caret is solid while typing and blinks 16 f on / 16 f off only once done.
5. Send: the composer text fades out over 12 f (0.2 s) while a bubble rises 12-20 px over 16-18 f (0.27-0.3 s) starting 4 f (0.07 s) later: `add_motion_block_tool {"block": "chat_thread", "params": {"messages": ["<prompt>"], "assistant": "<reply>"}, "position_seconds": 1.2, "duration_seconds": 5.0}`.
6. `add_sfx_tool {"recipe": "typing_burst", "at_seconds": 0.0, "gain_db": -22, "duration": 1.1}`.

## Timing & taste rules

- cinetic's timing (60 fps): Time box 68 f (1.13 s), or 50-72 cps (0.8-1.2 characters per frame); card width 24 f (0.40 s), +1 line per wrap in 12 f (0.20 s) on ease_out_expo; read hold after typing at least 36 f (0.60 s) + 6 f (0.10 s) per word, kept alive by the breath; send: 12 f (0.20 s) out, bubble 16-18 f (0.30 s) in with a 4 f (0.07 s) offset.
- Time-box the typing to 68 f (1.13 s) or 50-72 characters per second (0.8-1.2 per frame) so prompts of any length keep the beat length.
- Card width 67 to 77 % over 24 f (0.4 s); each wrap adds a line over 12 f (0.2 s).
- Read hold after typing at least 36 f + 6 f per word (0.6 s + 0.1 s per word).
- Send: 12 f (0.2 s) out, bubble 16-18 f (0.27-0.3 s) in, 4 f (0.07 s) offset.

## Sound for it

One typing_burst at -22 dB that matches the typing length, ending on the last character; a soft mouse_click at -22 dB on send.

## Common mistakes

- A prompt over about 100 characters: cut it.
- A human-paced beat is the point: use 30 characters per second with human rhythm.
- The product is not input-driven.
- Avoid when: The prompt runs past about 100 characters (cut it); a human-paced beat is the point (use 30 cps with human rhythm); the product is not input-driven.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-fast-prompt-true-scale`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
