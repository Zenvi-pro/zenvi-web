---
id: cin-pd-drag-assets-skeleton-fill
kind: technique
summary: "When the product takes real material in, a fan of images is dragged into the input and fills grey placeholders."
categories: [cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_clip_properties_tool, add_emoji_tool, add_clip_to_timeline_tool, add_sfx_tool, set_keyframes_tool]
pace: medium
mood: [hands-on, tactile, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [prompt-bar-typing-hero, cin-pd-fast-prompt-true-scale, cin-pd-ghost-suggestion-accept]
avoid_with: [cin-ui-clutter-pileup-strip, kcut-hit-fx]
needs: []
drawn: cinetic
---

# Drag assets in, skeletons fill

cinetic `pd-drag-assets-skeleton-fill` · Product demo · accent · energy medium · formats feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The cursor drags a fanned stack of images into the input; after the drop they appear as grey skeleton thumbnails that fill with the real images one by one.

Use when: The product takes real material as input (files, photos, documents) and the viewer should see that context going in.

## Build it in Zenvi

1. The input screen is a clip on track 1; four image cards on tracks 3-6, rotated -12, -4, 4 and 12 degrees (`set_clip_properties_tool` rotation), the pointer a clip on track 7: `add_emoji_tool {"emoji": "backhand index pointing up", "size": 0.06, "position_seconds": 0.0, "duration_seconds": 4.0, "track": "7"}`.
2. The drag: about 72 f (1.2 s) `ease_in_out_sine` along a shallow arc (bow 0.2): sample `location_x`/`location_y` of the pointer every 6 f (0.1 s) with `interpolation: "linear"`, and give each card the same path delayed 1 f (0.017 s) behind the card above it so the fan trails.
3. Mark the pickup and the release with a press: the pointer scales 1 to 0.9 in 4 f (0.07 s), back in 8 f (0.13 s).
4. On the drop (or just after a cut) the thumbnails mount as grey rounded rects in the attachment row: `add_clip_to_timeline_tool {"file_id": "<grey_plate>", "position_seconds": <drop>, "duration_seconds": 3.0, "track": "3"}` x4, each image fading up over 8 f (0.13 s) with `scale_x`/`scale_y` 1.04 to 1 on `ease_in_out_sine`, 6-10 f (0.1-0.17 s) apart (about 36 f = 0.6 s for four).
5. The input's other contents move down as the attachment row opens over 18 f (0.3 s); the drag path stays clear of any text being read.
6. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <drop>, "gain_db": -20}` on the drop and a soft `paper` at -26 dB per thumbnail fill.

## Timing & taste rules

- cinetic's timing (60 fps): Drag ≈ 72 f (1.20 s) on ease_in_out_sine; thumbnails 8 f (0.13 s) each at a 6-10 f (0.17 s) stagger (≈ 36 f (0.60 s) for four); attachment row opens over 18 f (0.30 s) on ease_in_out_cubic.
- Drag about 72 f (1.2 s) on ease_in_out_sine, bow 0.2, fan tilts -12 / -4 / 4 / 12 degrees, each card 1 f behind the one above.
- Thumbnails 8 f (0.13 s) each at a 6-10 f (0.1-0.17 s) stagger, 1.04 to 1 scale; attachment row opens over 18 f (0.3 s).
- Press 4 f (0.07 s) down, 8 f (0.13 s) recoil.
- Six assets or fewer.

## Sound for it

A ui_tap at -20 dB on the drop frame and a faint paper tick at -26 dB per thumbnail fill; the drag itself is silent.

## Common mistakes

- Text-only input: there is nothing to drag in.
- A drag path that crosses text being read.
- More than six assets: show a count chip instead.
- Avoid when: The input is text only; the drag path would cross text being read; more than six assets (show a count chip instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-drag-assets-skeleton-fill`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
