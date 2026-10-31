---
id: cin-ui-shell-first-build
kind: technique
summary: "When a real screen first appears, its empty frame lands first, contents fill in left to right, the button last."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [clear, ordered, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-row-cascade, cin-ui-card-grid-arrival, cin-pd-blur-resolve-load]
avoid_with: [cin-pd-device-rise-on-cut, shot-slam-entrance]
needs: [keyframed-polygon-mask]
drawn: cinetic
---

# Shell first, then contents, then the action

cinetic `ui-shell-first-build` · UI choreography · workhorse · energy medium · formats launch, feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The empty container is on screen first, its contents arrive left to right, the card unfolds downward in stages, and the primary button fills last as the clear call to act.

Use when: The first appearance of any real product screen, especially dashboards, headers and forms whose reading order matters.

## Build it in Zenvi

1. Shell first: an image of the empty container (bar, card, window) at t0: `add_clip_to_timeline_tool {"file_id": "<shell>", "position_seconds": 0.0, "duration_seconds": 4.0, "track": "2"}`; each child (icon, label, field, media slot) is its own clip on a higher track.
2. Children enter in reading order, 4 f (0.067 s) apart, each rising 6 px (0.0056 of height) while fading in over 12 f (0.2 s): `set_keyframes_tool {"timeline_clip_id": "<child_i>", "property": "alpha", "points": [{"seconds": <s>, "value": 0}, {"seconds": <s+0.2>, "value": 1, "ease": "ease_out_expo"}]}` and `location_y` 0.0056 to 0 on the same curve. Media slots appear as a grey rounded rect and fill with the image over 8 f (0.13 s), 8 f apart.
3. The primary action comes last: its fill (a solid clip) ramps alpha 0 to 1 `linear` over 16 f (0.27 s) starting +20 f (0.33 s); its label clip swaps to the inverted colour on one frame at +28 f (0.47 s).
4. Unfold a card downward in stages (header, then stats row after 36 f / 0.6 s, then the full card after 24 f / 0.4 s): stack the three parts as clips and enter each with `set_keyframes_tool` `alpha` plus `location_y`; the true bottom-edge inset needs a keyframed mask, so approximate with `scale_y` 0 to 1 and `origin_y` 0 on a plain block behind them.
5. An in-UI headline: `add_kinetic_title_tool {"text": "<headline>", "animation": "rise", "stagger_seconds": 0.1, "position_seconds": 0.4}`. Each stage waits until the previous slot is 60 % open. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 0.47, "gain_db": -22}`.

Fallback: For the card unfold, stage three stacked images (header, stats, full) with alpha steps 0.6 s and 0.4 s apart instead of a moving bottom edge.

## Timing & taste rules

- cinetic's timing (60 fps): Children 4 f (0.07 s) stagger, 12 f (0.20 s) each (ease_out_expo), 6 px rise. Media fill 8 f (0.13 s), 8 f (0.13 s) apart. Button fill 16 f (0.27 s) (linear) from +20 f (0.33 s); label inverts at +28 f (0.47 s). Unfold 36 f (0.60 s) then 24 f (0.40 s) (ease_in_out_sine), content at 60% open. In-UI headline 6 f (0.10 s) per word.
- Children 4 f (0.067 s) stagger, 12 f (0.2 s) each, 6 px rise; media fill 8 f (0.13 s), 8 f apart.
- Button fill 16 f (0.27 s) linear from +20 f (0.33 s); the label colour inverts on one frame at +28 f (0.47 s).
- Unfold 36 f (0.6 s) then 24 f (0.4 s); each stage's contents start once its slot is 60 % open.
- Shot at least 40 f (0.67 s) long, or the staging cannot read.

## Sound for it

One soft ui_tap at -22 dB on the button fill; the child entrances stay silent.

## Common mistakes

- The screen should feel already alive on the cut: enter it moving instead.
- A shot shorter than about 40 f (0.67 s).
- Contents arriving before their container is mostly open: they float in air.
- Avoid when: The screen should feel already alive on the cut (enter it moving with a rise-in), or the shot is shorter than about 40 f.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-shell-first-build`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
