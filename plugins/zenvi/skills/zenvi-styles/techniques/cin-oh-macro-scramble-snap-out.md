---
id: cin-oh-macro-scramble-snap-out
kind: technique
summary: "When one metric is the proof: giant digits re-roll past the frame, then snap back to the whole figure and lock."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool, set_audio_gain_tool]
pace: fast
mood: [bold, numeric, urgent]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [big-number-lockup-and-counter, kinetic-counter, cin-oh-quiet-intro-drop]
avoid_with: [cin-oh-mark-build-and-throw, cinematic-push-in]
needs: [digit-column-reroll-control]
drawn: cinetic
---

# Macro number scramble, one-frame snap-out

cinetic `oh-macro-scramble-snap-out` · Opening hook · signature · energy high · formats launch, sting, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Huge digits fill and overflow the frame, re-rolling every frame. On one frame the view cuts back to the whole figure, which rolls into the final metric and holds: the number is the hook before any brand appears.

Use when: The strongest proof is one metric (users, hours saved, uptime) and the film earns attention with the outcome before the brand.

## Build it in Zenvi

1. The figure: `add_motion_block_tool {"block": "counter", "position_seconds": 0, "duration_seconds": 3.2, "placement": "full_frame", "params": {"values": ["734921","2.4M"], "style": "odometer", "align": "center", "weight": 700}}` sized so the whole string spans about 90 % of the frame width.
2. Macro phase: `set_keyframes_tool {"timeline_clip_id": "<counter>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.22}, {"seconds": 0.467, "value": 1.22}, {"seconds": 0.483, "value": 1.0}]}` (same on `scale_y`): f29 (0.483 s) is the one-frame snap, no tween.
3. After the snap hold on a breath: `{"seconds": 0.483, "value": 1.0}, {"seconds": 1.7, "value": 1.08, "ease": "ease_in_out_sine"}` on both scales (+0.065 %/f).
4. Final string forced from f41 (0.68 s) with the lock-in running left to right, 3 f (0.05 s) per column; keep the brand out until the end card.
5. Sound: five dry ticks `add_sfx_tool {"recipe": "glitch_burst", "at_seconds": 0.17, "gain_db": -18}` at 0.17 / 0.23 / 0.31 / 0.36 / 0.40 s, then the bed ducks at least 30 dB on the lock frame: `automate_volume_tool {"role": "music", "shape": "dip", "start_seconds": 0.483, "end_seconds": 1.8, "db": -30, "fade_ms": 20}` and stays down through the hold.

Fallback: The counter block rolls on its own schedule; if the digit churn is too orderly, place two counters with different value lists back to back, cutting from the first to the second on f29.

## Timing & taste rules

- cinetic's timing (60 fps): Macro 29 f (0.48 s); snap 1 f (0.02 s) at f29 (0.48 s); settle 12 f (0.20 s); final string forced from f41 (0.68 s); hold 72 f (1.20 s) with only the scale drift. Ticks at about 0.17, 0.23, 0.31, 0.36 and 0.40 s.
- Macro 29 f (0.48 s); snap 1 f at f29; settle 12 f (0.20 s); final string forced from f41 (0.68 s); hold 72 f (1.2 s) with only the scale drift.
- Whole figure spans ~0.9 of the width at the snap; macro is a 1.22x overscan of that.
- Columns lock left to right 3 f (0.05 s) apart; keep the masks 1.6 lines tall during the macro so outgoing digits overflow.
- No glints, sparkles or halo in the hold: the number is the picture.
- Bed silent through the hold; the identical tick cluster can bookend the closing sting.

## Sound for it

Five soft `glitch_burst` ticks in the first 0.6 s (f10-f24), then near-silence from the lock frame (bed -30 dB or more within one frame).

## Common mistakes

- No credible or impressive number, or a calm premium tone (avoid_when): use a quieter opener.
- Tweening the snap over 4-6 f: it becomes a normal zoom-out; it is one frame.
- Showing the brand in the hold: the film earns attention with the outcome first.
- Avoid when: There is no credible or impressive number, or the tone is calm and premium.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-macro-scramble-snap-out`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
