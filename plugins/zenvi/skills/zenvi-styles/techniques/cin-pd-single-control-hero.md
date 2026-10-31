---
id: cin-pd-single-control-hero
kind: technique
summary: "When one setting is the claim, show only its native control, huge and centred, doing its one interaction."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [focused, tactile, minimal]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-hard-swap-on-cause, cin-mi-guide-cursor-hover-press, shot-control-state-change]
avoid_with: [cin-pd-ui-native-transitions, cin-ui-card-grid-arrival]
needs: []
drawn: cinetic
---

# One native control as the demo

cinetic `pd-single-control-hero` · Product demo · workhorse · energy calm · formats feature, launch, vertical, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Instead of a screenshot, the feature is shown as the single control that embodies it (a picker wheel, a toggle, a segmented switch) at large scale, centred, with no chrome, doing only its native interaction.

Use when: A settings, targeting or compatibility claim in a type-led film, where one interaction says it is a real product faster than a full UI.

## Build it in Zenvi

1. Picker: `add_type_block_tool {"block": "wheel", "words": ["<opt1>", "<opt2>", "<opt3>", "<opt4>", "<opt5>"], "hold_frames": 30, "text_size": 0.09, "position_seconds": 0.0, "duration_seconds": 3.0}` (a drum that turns and rests on the last word; lines away from the centre squash and dim, which is the same distance falloff as scale 1.2 down to 0.85).
2. Toggle or segmented switch: `add_motion_block_tool {"block": "toggle_panel", "params": {"title": "<setting>", "rows": ["<the one switch>"], "cursor": true}, "position_seconds": 0.0, "duration_seconds": 4.0}` and enlarge it to 3-5x its normal size: `set_keyframes_tool {"timeline_clip_id": "<panel>", "property": "scale_x", "points": [{"seconds": 0.0, "value": 3.0}]}` (same for scale_y), centred on an empty stage, no app chrome.
3. Picker speed: the column starts at 20 px/f (the readable-text limit), roughly 790 px of travel with a 40 f (0.67 s) time constant; an item crosses the focus about every 30 f (0.5 s) early on, slowing after.
4. Either cut while it still drifts, or land on the chosen item and settle in about 12 f (0.2 s) on `ease_out_back` with a very small overshoot. The toggle knob moves in 8 f (0.13 s) on `ease_in_out_sine`; a segmented pill glides between labels over 18-24 f (0.3-0.4 s).
5. `add_sfx_tool {"recipe": "toggle", "at_seconds": <knob>, "gain_db": -18}` on the knob frame; for a picker one `ui_tap` at -24 dB per item that crosses focus, fewer as it slows.

## Timing & taste rules

- cinetic's timing (60 fps): Shot ≈ 120 f (2.00 s); picker v0 20 px/f, decay 0.975 per frame, an item crossing focus about every 30 f (0.50 s) early on and slowing after; detent settle ≈ 12 f (0.20 s); toggle knob 8 f (0.13 s); segment glide 18-24 f (0.40 s).
- Shot about 120 f (2.0 s); the control at 3-5x native size, centred, nothing else on the stage.
- Picker: start 20 px/f, decay 0.975 per frame; item scale 1.2 minus 0.35 times distance/375 px, colour and opacity 1 to 0.35 on the same ratio.
- Detent settle about 12 f (0.2 s); toggle knob 8 f (0.13 s); segment glide 18-24 f (0.3-0.4 s).
- No app chrome, no labels competing with the control.

## Sound for it

One toggle click at -18 dB on the knob frame, or a ui_tap per item that crosses the focus line, fading out as the picker slows.

## Common mistakes

- The feature needs context to make sense: the lone control says nothing.
- A generic control (every app has a toggle) that carries no claim.
- Adding chrome back around it, which undoes the isolation.
- Avoid when: The feature needs context to make sense; the control is generic (every app has a toggle) and says nothing about the claim.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-single-control-hero`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
