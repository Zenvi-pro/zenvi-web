---
id: cin-pd-agent-status-then-answer
kind: technique
summary: "When an AI product does invisible work, show its tiny status at hero size with a spinner, hold, then stream the answer."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, apply_fx_tool, add_emoji_tool, add_sfx_tool]
pace: calm
mood: [anticipating, quiet, AI product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-fast-prompt-true-scale, cin-pd-blur-resolve-load, prompt-bar-typing-hero]
avoid_with: [kcut-hit-fx, cin-ui-clutter-pileup-strip]
needs: []
drawn: cinetic
---

# Agent status beat, then streamed answer

cinetic `pd-agent-status-then-answer` · Product demo · workhorse · energy calm · formats launch, feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The product's tiny working status is shown at hero size, as a black capsule with a spinner and a typed label or as bare headline type, holds for a beat with a looping ellipsis or shimmer, then dissolves as the answer streams in.

Use when: An AI or agent product needs its invisible work made visible, and a moment of anticipation before the payoff.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same beat in one hue: the `prompt_bar` status pill with a flat ink fill and only a neutral soft shadow (no coloured blobs behind it, no `apply_fx_tool`).
2. A plain dot spinner or a clock glyph instead of a sparkle icon; the shimmer is three lightness stops of one grey.
3. The newest streamed characters trail from accent to ink, not through several colours. Timings unchanged.

**Full look** (relies on gradient, sparkle, glow: only when the person's brand supplies that look):

1. The status at hero size: `add_motion_block_tool {"block": "prompt_bar", "params": {"prompt": "", "status": "Thinking", "cursor": false, "position": "center"}, "position_seconds": 0.0, "duration_seconds": 3.0, "placement": "full_frame"}` (a shimmering pill with a looping ellipsis). Capsule height about 8.4 % of the frame, fully round, ink fill, label typed in about 30 f (0.5 s), its last word arriving in the accent and relaxing to ink over 24 f (0.4 s).
2. Hold 60-74 f (1.0-1.23 s): the ellipsis steps every 16 f (0.27 s), one shimmer sweep per 60 f (1.0 s); the camera settles 1.62 to 1: `set_keyframes_tool {"timeline_clip_id": "<status>", "property": "scale_x", "points": [{"seconds": 0.0, "value": 1.62}, {"seconds": 0.93, "value": 1.0, "ease": "ease_out_cubic"}]}` (56 f; same for scale_y).
3. Add a glow to the pill: `apply_fx_tool {"clip_id": "<status>", "effects": [{"effect": "bloom", "amount": 0.25}]}`; use a sparkle glyph (`add_emoji_tool`) in place of the spinner for the full look.
4. Dissolve the status over 12 f (0.2 s) `ease_in_out_sine` (`alpha` 1 to 0), then the answer streams: `add_motion_block_tool {"block": "chat_thread", "params": {"messages": ["<question>"], "assistant": "<answer>"}, "position_seconds": 1.4, "duration_seconds": 5.0}` at about 60 characters per second (about 1 per frame), the newest 3 characters at 30 / 60 / 85 % opacity.
5. If the status is the payoff itself: type it, hold 30 f (0.5 s), dim it to the muted colour over 12 f (0.2 s), no stream.
6. `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 1.4, "gain_db": -26}` under the first streamed word.

## Timing & taste rules

- cinetic's timing (60 fps): Label types in about 30 f (40 f (0.67 s) at headline size); hold 60-74 f (1.23 s) with the ellipsis stepping every 16 f (0.27 s) and one shimmer sweep per 60 f (1.00 s) (≈ 20 px/f); camera 1.62 → 1 over 56 f (0.93 s) on ease_out_cubic; dissolve 12 f (0.20 s); stream ≈ 1 character per frame (41 characters in about 42 f (0.70 s)); payoff variant: hold 30 f (0.50 s), dim 12 f (0.20 s).
- Label types in about 30 f (0.5 s), 40 f (0.67 s) at headline size; hold 60-74 f (1.0-1.23 s).
- Shimmer sweeps about 20 px/f, one per 60 f (1.0 s); ellipsis steps every 16 f (0.27 s).
- Camera settles 1.62 to 1 over 56 f (0.93 s) on ease_out_cubic.
- Dissolve 12 f (0.2 s), then stream about 1 character per frame (41 characters in 42 f / 0.7 s).

## Sound for it

One soft keyboard_key tick at -26 dB when the answer starts; the hold stays quiet under the bed.

## Common mistakes

- The product is not autonomous, so the work has nothing to show.
- A hold longer than about 74 f (1.23 s): anticipation turns to waiting.
- A second status beat in the same film.
- Avoid when: The product is not autonomous; the hold would run past about 74 f; a second status beat in the same film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-agent-status-then-answer`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
