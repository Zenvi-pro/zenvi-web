---
id: cin-pd-mark-docks-into-app
kind: technique
summary: "When an integration plugs in, its mark glides to an app tile and settles in front of it at contact."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, split_clip_tool, move_clip_tool, add_sfx_tool]
pace: medium
mood: [connecting, tidy, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-shared-element-page, shot-source-hub-connect, shot-ui-to-brand-morph]
avoid_with: [cin-ui-clutter-pileup-strip, kcut-hit-fx]
needs: []
drawn: cinetic
---

# Mark docks into the app

cinetic `pd-mark-docks-into-app` · Product demo · accent · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

An integration mark or icon travels to an app tile or page and settles overlapping its face, rising in front of it at the moment of contact, so it reads as plugging in.

Use when: An integration, plug-in or works-inside claim; handing off from a settings screen into the platform it acts on.

## Build it in Zenvi

1. Tile and mark as separate clips: tile on track 2, mark on track 3: `add_clip_to_timeline_tool {"file_id": "<mark>", "position_seconds": 0.0, "duration_seconds": 3.0, "track": "3"}`.
2. Move the mark toward the tile centre minus a 15-20 % offset (of the tile) over 25 f (0.42 s) so it decelerates into contact: `set_keyframes_tool {"timeline_clip_id": "<mark>", "property": "location_x", "points": [{"seconds": 0.0, "value": <start_x>}, {"seconds": 0.42, "value": <tile_x - 0.17*tile_w>, "ease": "ease_out_cubic"}]}` plus `location_y`.
3. At overlap (f17 = 0.28 s) the mark must rise in front: `split_clip_tool {"clip_id": "<mark>", "at_seconds": 0.28}` and move the second half to a track above the tile (`move_clip_tool {"clip_id": "<half_2>", "track": "4"}`), the keyframes continuing unbroken.
4. The tile answers on contact: `set_keyframes_tool {"timeline_clip_id": "<tile>", "property": "scale_x", "points": [{"seconds": 0.42, "value": 1.02}, {"seconds": 0.55, "value": 1.0, "ease": "ease_out_expo"}]}` (same for scale_y; attack 2 f = 0.03 s, about 8 f = 0.13 s total). Tile is a matte solid with a 1.5 px hairline and a soft neutral shadow.
5. Shared-element variant: lift a small icon out of its row (scale 0.53 to 1 over 27 f = 0.45 s) `ease_out_expo` while its tile inverts, float it 45 f (0.75 s) with a 1.5-degree `rotation` drift, then shrink it over 12 f (0.2 s) `ease_in_out_expo` into the logo slot of the page; on arrival swap to the page's own logo in ONE frame, not a crossfade.
6. `add_sfx_tool {"recipe": "pop", "at_seconds": 0.42, "gain_db": -20}`.

Fallback: The tilted page swing of the variant needs a perspective plane; use a straight slide-in instead.

## Timing & taste rules

- cinetic's timing (60 fps): Approach 25 f (0.42 s) on ease_out_cubic, overlap at f17 (0.28 s), rest at f25 (0.42 s); tile bump 2% (attack 2 f (0.03 s), tau 3, about 8 f (0.13 s)). Variant: lift 27 f (0.45 s), colour invert 18 f (0.30 s), float 45 f (0.75 s), shrink 12 f (0.20 s) on ease_in_out_expo, page swing 50 f (0.83 s) on ease_out_expo, one-frame swap to the page logo on arrival.
- Approach 25 f (0.42 s) on ease_out_cubic; overlap at f17 (0.28 s); at rest on f25.
- Tile bump 2 % with attack 2 f (0.03 s), about 8 f (0.13 s) long.
- Shared-element variant: lift 27 f (0.45 s), invert 18 f (0.3 s), float 45 f (0.75 s), shrink 12 f (0.2 s).
- Swap to the destination logo in one frame with an identical transform.

## Sound for it

One soft pop at -20 dB on the contact frame, f25 (0.42 s); no sound on the approach.

## Common mistakes

- The mark would pass over text being read.
- The mark is also the end lockup: it would appear early, so dock an integration icon instead.
- Crossfading the icon and the page logo at the end instead of swapping in one frame.
- Avoid when: The mark would pass over text being read; the mark is also the end lockup (it would appear early, so dock an integration icon instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-mark-docks-into-app`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
