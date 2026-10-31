---
id: cin-ui-card-grid-arrival
kind: technique
summary: "When options must read as one set, cards land in a row or grid one by one, dealt with a tilt or dropped in."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_clip_properties_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [tactile, orderly, clear]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-row-cascade, cin-ui-fan-resolve-to-slots, shot-card-stack-fan]
avoid_with: [shot-slam-entrance, cin-ui-clutter-pileup-strip]
needs: []
drawn: cinetic
---

# Cards dealt or dropped into a grid

cinetic `ui-card-grid-arrival` · UI choreography · workhorse · energy medium · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Cards land in a row or grid one after another, either dealt fast with a small tilt that squares up, or falling from just in front of the camera and shrinking into their slots.

Use when: Revealing a set of options, results, features or integrations that should read as one set with a clear reading order.

## Build it in Zenvi

1. Cards are images of the real screens or features, one clip each: `add_clip_to_timeline_tool {"file_id": "<card_i>", "position_seconds": <t0 + 0.083*i>, "duration_seconds": 3.0, "track": "<n+i>"}`; place each with `set_clip_properties_tool` into its row slot.
2. Deal preset: card i appears at t0 + 5 f * i (0.083 s * i), alpha stepping to 1 on the first frame while `rotation` goes 4 to 0 and scale 0.95 to 1 over 7 f (0.12 s): `set_keyframes_tool {"property": "rotation", "points": [{"seconds": <s>, "value": 4}, {"seconds": <s+0.12>, "value": 0, "ease": "ease_out_expo"}]}` and `scale_x`/`scale_y` 0.95 to 1, no overshoot.
3. Depth-drop preset: delays 0, 4, 10, 14 f (0, 0.07, 0.17, 0.23 s), `location_y` +0.49 (534 px) to 0 and scale 1.38 to 1 over 54 f (0.9 s) `ease_out_expo`; keep each card's inner content (a second clip) at alpha 0 until +8 f, in by +16 f.
4. Over a blurred plate instead of your own cards, `add_motion_block_tool {"block": "glass_cards", "params": {"cards": ["<a>", "<b>", "<c>", "<d>"], "headline": "<line>"}, "position_seconds": <t0>, "duration_seconds": 4.0}` is the ready-made depth entrance.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <s>, "gain_db": -24}` per landing, at most 4.

## Timing & taste rules

- cinetic's timing (60 fps): Deal: 5 f (0.08 s) stagger, 7 f (0.12 s) settle (ease_out_expo), rotate 4 deg, scale 0.95. Drop: 54 f (0.90 s) (ease_out_expo), stagger 0/4/10/14 f (0.23 s), 534 px, scale 1.38 to 1, peak ~62 px/f, content fades in from +8 to +16 f (0.27 s).
- Deal: 5 f (0.08 s) stagger, 7 f (0.12 s) settle on ease_out_expo, 4 degrees to 0, scale 0.95 to 1, no overshoot.
- Drop: 54 f (0.9 s) ease_out_expo, stagger 0 / 4 / 10 / 14 f, 534 px (about 49 % of height), peak about 62 px/f; text resolves only after the card slows below 20 px/f.
- Cards are opaque with a soft shadow (about 6 % black) and a radius of about 3 % of frame height.
- Keep to 8 cards or fewer, in clear reading order.

## Sound for it

One quiet ui_tap per card on its landing frame, descending in level so they do not stack into a rattle; the drop preset can take a single impact_thud at -16 dB under the last card.

## Common mistakes

- One hero object or more than about 8 cards: use a row cascade or a scroll instead.
- Content visible while the card is still fast: it smears, so fade it in on landing.
- Overshoot on a deal: it turns a dealt card into a bounce toy.
- Avoid when: There is one hero object, or more than about 8 cards (use a row cascade or a scroll).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-card-grid-arrival`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
