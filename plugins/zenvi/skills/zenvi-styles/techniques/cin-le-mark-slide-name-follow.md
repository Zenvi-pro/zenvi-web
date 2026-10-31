---
id: cin-le-mark-slide-name-follow
kind: technique
summary: "When the mark is already on screen: it slides aside and the name resolves beside it as one lockup gesture."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [resolved, branded]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [t061, cin-le-living-hold, cin-le-hot-to-neutral-cool]
avoid_with: [cin-le-reverse-type-recentre, cin-le-macro-pullout-breathe]
needs: []
drawn: cinetic
---

# Mark slides aside, name follows

cinetic `le-mark-slide-name-follow` · Logo and end card · workhorse · energy medium · formats launch, feature, sting, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The centred mark glides sideways, shrinking if it was hero-sized, to open its slot, and the name resolves beside it just before the mark stops, so the lockup forms in one gesture.

Use when: Any end card whose mark is already on screen (it was the story device or the hero) and the name still has to arrive. The default lockup build.

## Build it in Zenvi

1. The mark centred: `add_clip_to_timeline_tool {"file_id": "<logo>", "position_seconds": 0, "duration_seconds": 4.5, "track": "3"}`.
2. Slide it to its lockup slot (36 f, 0.6 s, for up to 250 px): `set_keyframes_tool {"timeline_clip_id": "<logo>", "property": "location_x", "ease": "ease_in_out_sine", "points": [{"seconds": 1.0, "value": 0}, {"seconds": 1.6, "value": -0.12}]}` and, if it was hero-sized, `scale_x/y` 1.6 to 1 on the same window. In 9:16 stack instead: mark `location_y` up by half the name's height plus the gap.
3. Name starts when the slide passes 55-60 % (at 1.35 s): `add_kinetic_title_tool {"text": "Zenvi", "style": "documentary", "animation": "rise", "stagger_seconds": 0.05, "text_size": 0.07, "y": 0.5, "position_seconds": 1.35, "duration_seconds": 3.2}` with letters 3 f (0.05 s) apart, 16 f (0.27 s) each, arriving grey and settling to ink.
4. Tighten the name from its resolve: a 1.5 % `scale_x` ease on the name title (0 to 0.77 s, `ease_out_expo`) stands in for letter-spacing +0.04 em to normal over 46 f.
5. A round mark rolls: `rotation` 0 to -(dx / r) in degrees on the same window.
6. `add_sfx_tool {"recipe": "hit_transient", "at_seconds": 1.95, "gain_db": -12}` on the frame the name resolves.

## Timing & taste rules

- cinetic's timing (60 fps): Slide: 36 f (0.60 s) for up to ~250 px (ease_in_out_sine peaks ~20 px/f), 60 f (1.00 s) for ~350 px (~17 px/f). Motion-blur pass on the mark whenever it moves faster than 12 px/f. Name starts at 0.55-0.6 x D: a block takes 14 f (0.23 s); letters take 16 f (0.27 s) each at a 3 f (0.05 s) stagger (10 letters inside ~43 f (0.72 s)). Tracking: 46 f (0.77 s) on ease_out_expo. Lockup resolved by about D + 20 f (0.33 s), then hold 90-120 f (2.00 s).
- Mark height = name cap height, gap 0.25-0.4x the mark height; lockup 28-45 % of frame width.
- Slide 36 f (0.6 s) for up to ~250 px (peak about 20 px/f), 60 f (1 s) for ~350 px; add motion blur whenever the mark exceeds 12 px/f.
- Name starts at 0.55-0.6 of the slide; letters 16 f (0.27 s) each at a 3 f (0.05 s) stagger; lockup resolved by about slide + 20 f.
- Hold 90-120 f (1.5-2 s) after, never past about 150 f.

## Sound for it

One hit_transient at -12 dB on the frame the name resolves; the slide itself gets none.

## Common mistakes

- A mark that has not been seen yet: give it its own beat first.
- Long names that push the slide past about 400 px: stack vertically.
- Reusing a slide-to-make-room that the film already used for the product.
- Avoid when: The mark has not been seen yet (give it its own beat first). The film already used a slide-to-make-room for the product. Long names that would push the slide past ~400 px (stack vertically instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-mark-slide-name-follow`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
