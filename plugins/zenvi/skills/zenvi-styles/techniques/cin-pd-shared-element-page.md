---
id: cin-pd-shared-element-page
kind: technique
summary: "When a click opens a detail view, all drains away but the clicked icon, which holds as the new page builds."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_clip_properties_tool, set_keyframes_tool, add_effect_tool, update_effect_tool, add_sfx_tool, add_clip_to_timeline_tool]
pace: medium
mood: [continuous, instant, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-mark-docks-into-app, cin-ui-container-morph, cin-pd-ui-native-transitions]
avoid_with: [cinematic-whip-cut, cin-pd-hard-swap-on-cause]
needs: []
drawn: cinetic
---

# Shared element survives the page change

cinetic `pd-shared-element-page` · Product demo · signature · energy medium · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The cursor clicks a row; the page drains away except the row's icon (or the clicked card), which stays exactly in place while the next page assembles around it with a short zoom-out.

Use when: Navigating into a detail view, or carrying a piece of content between apps, where spatial continuity should make the product feel instant.

## Build it in Zenvi

1. Page A and page B are two clips (real recordings or screenshots) back to back on track 1; the anchor (a row icon or card) is cut out as a third clip on track 3, placed at its exact screen rect on page A (`set_clip_properties_tool` location/scale).
2. On the press frame, page A fades to its background colour over 6 f (0.1 s): `set_keyframes_tool {"timeline_clip_id": "<page_a>", "property": "alpha", "points": [{"seconds": 1.0, "value": 1}, {"seconds": 1.1, "value": 0, "ease": "ease_in_out_sine"}]}`; the lone anchor holds 2-4 f (0.03-0.07 s).
3. Page B mounts at scale 1.2 about the anchor and settles over 24 f (0.4 s): `scale_x`/`scale_y` 1.2 to 1.0 `ease_out_expo` with `origin_x`/`origin_y` at the anchor; its blocks fade in 2 f (0.03 s) apart over 10 f (0.17 s).
4. The anchor moves from page A's rect to page B's: `location_x`/`location_y`/`scale` keyframes over the same 24 f; about 48 f (0.8 s) from click to settled.
5. Cross-app variant: keep one card, take child A out with `Blur` radius to 8 px and alpha over 36 f (0.6 s) (`add_effect_tool` + `update_effect_tool`), resize the card over 20 f (0.33 s), bring child B in from 8 px over 24 f (0.4 s).
6. Cut variant: the anchor stays on the top track while only the background clip switches on the cut frame, then drag the anchor into its new slot over 40 f (0.67 s) on `ease_in_out_expo`. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 1.0, "gain_db": -22}`.

## Timing & taste rules

- cinetic's timing (60 fps): Hover 12 f (0.20 s), press (pressAt), page A out 6 f (0.10 s), anchor alone 2-4 f (0.07 s), page B 1.2 → 1 over 24 f (0.40 s) on ease_out_expo (≤ 50 px/f at 960 px from the anchor), block stagger 2 f (0.03 s) over 10 f (0.17 s): about 48 f (0.80 s) from click to settled. Cross-app: 36 f (0.60 s) out, 20 f (0.33 s) resize, 24 f (0.40 s) in. Cut variant: anchor drag 40 f (0.67 s) on ease_in_out_expo.
- Hover 12 f (0.2 s), press, page A out 6 f (0.1 s), anchor alone 2-4 f (0.03-0.07 s), page B 1.2 to 1 over 24 f (0.4 s), about 48 f (0.8 s) in all.
- Blocks stagger 2 f (0.03 s) over 10 f (0.17 s); the farthest edge at most 50 px/f.
- Cross-app: 36 f (0.6 s) out, 20 f (0.33 s) resize, 24 f (0.4 s) in.
- Anchor at least about 40 px (4 % of height) so it can hold attention.

## Sound for it

One ui_tap at -22 dB on the press; the page build is silent, or a very soft whoosh_short at -26 dB.

## Common mistakes

- Nothing exists in both states, so there is nothing to carry.
- An anchor under about 40 px that cannot hold attention.
- An anchor that must travel more than a third of the frame: use a native transition.
- Avoid when: Nothing exists in both states; the anchor is under about 40 px and cannot carry attention; it would need to travel more than a third of the frame (use a native transition).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-shared-element-page`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
