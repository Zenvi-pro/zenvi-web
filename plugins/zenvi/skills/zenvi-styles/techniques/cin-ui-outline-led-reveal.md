---
id: cin-ui-outline-led-reveal
kind: technique
summary: "When a click creates a row or dialog, a bright line or outline opens first, then thins away as the content takes over."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, apply_fx_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [precise, signalling, product]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [cin-ui-row-cascade, cin-ui-anchor-point-spawn, cin-ui-top-insert-push]
avoid_with: [cin-ui-stalled-state, cinematic-bleach-bypass]
needs: []
drawn: cinetic
---

# Outline-led insert and spawn

cinetic `ui-outline-led-reveal` · UI choreography · signature · energy medium · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A thin accent line or a heavy outline appears first and opens into a new row or a modal, then the stroke decays to a hairline so the content takes over.

Use when: A click that creates something (a new account, row, record or dialog) that must read from a wide shot, or repeated creation shown as a rhythm.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same line: a flat 2 px accent bar (`add_title_tool` with `background_color`), no `apply_fx_tool`, no bloom or glow anywhere.
2. Show the flash as width and opacity instead: `set_keyframes_tool {"property": "scale_y", "points": [{"seconds": 1.0, "value": 1.0}, {"seconds": 1.07, "value": 1.5}, {"seconds": 1.17, "value": 1.0}]}` (2 px to 3 px for 4 f), and alpha 1 to 0.4 to 0 over 24 f (0.4 s).
3. Frame the modal with a solid 6-10 px accent outline clip that thins to 1 px over 12 f (0.2 s); the row opens, the inserts repeat every 41 f (0.68 s) and the ticks stay unchanged.

**Full look** (relies on glow: only when the person's brand supplies that look):

1. Row insert: the accent line, a 2 px (0.002 of height) thin line clip across the list at the insert position, appearing in one frame: `add_title_tool {"text": " ", "background_color": "<accent>", "fit_text": false, "position_seconds": 1.0, "duration_seconds": 0.6}` (a thin accent bar) and `apply_fx_tool {"clip_id": "<line>", "effects": [{"effect": "bloom", "amount": 0.4, "start": 0.0, "end": 0.15}]}` for the glow at its peak.
2. The row opens from height 0 over 10 f (0.17 s): `set_keyframes_tool {"timeline_clip_id": "<row>", "property": "origin_y", "points": [{"seconds": 1.0, "value": 0}]}` then `scale_y` 0 to 1 `ease_in_out_sine`; rows below shift with `location_y`, 20 px/f or less. Its content fades in over the last 4 f (0.07 s).
3. The row's border decays from the accent to 40 % over 24 f (0.4 s) linear, then to nothing: `set_keyframes_tool {"timeline_clip_id": "<border>", "property": "alpha", "interpolation": "linear", "points": [{"seconds": 1.17, "value": 1}, {"seconds": 1.57, "value": 0.4}, {"seconds": 1.9, "value": 0}]}`. Repeat inserts every 41 f (0.68 s), three in all.
4. Modal spawn: `scale_x`/`scale_y` 0.07 to 1 over 26 f (0.43 s) `ease_out_expo` about the trigger point (`origin_x`/`origin_y`); the accent outline clip runs 6, 10, 1 px wide, then thins to 1 px over 12 f (0.2 s) with opacity to 0.3.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.0, "gain_db": -22}` on each line frame.

## Timing & taste rules

- cinetic's timing (60 fps): Line 1 f (0.02 s); open 10 f (0.17 s) (ease_in_out_cubic); border decay 24 f (0.40 s) (linear); content in the last 4 f (0.07 s); inserts every 41 f (0.68 s). Modal 26 f (0.43 s) (lmix on ease_out_expo) from scale 0.07, far edge ~52 px/f; stroke 6/10/1 px; thin 12 f (0.20 s); opacity to 0.3.
- Line appears in 1 f; the row opens in 10 f (0.17 s); border decay 24 f (0.4 s) linear; content in the last 4 f (0.07 s); inserts every 41 f (0.68 s).
- Modal 26 f (0.43 s) from scale 0.07 on ease_out_expo; stroke 6 / 10 / 1 px, thinning over 12 f (0.2 s) to opacity 0.3.
- Use the film's single accent only; the outline is a signal, not decoration.
- The row push stays at 20 px/f or less.

## Sound for it

A ui_tap at -22 dB on each line frame (three inserts give a countable rhythm); the modal gets one pop at -20 dB on its landing.

## Common mistakes

- The accent already means something else in the film: the line then reads as a different event.
- A calm monochrome close-up where a bright stroke would shout.
- Leaving the border at full strength: it must decay to a hairline so the content wins.
- Avoid when: The accent already means something else in the film, or the shot is a calm monochrome close-up where a bright stroke would shout.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-outline-led-reveal`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
