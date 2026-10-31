---
id: cin-ui-container-morph
kind: technique
summary: "When a click opens something, one element reshapes into its next role, a button into a panel, a pill into a tile."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool, add_clip_to_timeline_tool]
pace: medium
mood: [fluid, seamless, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-anchor-point-spawn, cin-pd-shared-element-page, cin-mi-shape-handoff-morph]
avoid_with: [cin-ui-live-reflow, shot-glitch-tear-cut]
needs: []
drawn: cinetic
---

# Container morph into its next role

cinetic `ui-container-morph` · UI choreography · workhorse · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

One element changes shape into what it becomes, a button unfolding into a panel, a card stretching into a detail view, a pill collapsing into an app tile, so there is no navigation cut to explain.

Use when: A click that opens something (button to panel, card to detail), a status becoming an icon, an object docking into its slot.

## Build it in Zenvi

1. The container is one plain rounded block (no content, so stretching it cannot distort anything): `add_title_tool {"text": " ", "background_color": "<card>", "fit_text": false, "position_seconds": 0.0, "duration_seconds": 3.0, "track": "2"}`. Never swap in a second element.
2. Morph over 30-36 f (0.5-0.6 s) on `ease_in_out_expo`, long enough that the fastest edge stays under 70 px/f (frames >= 3.8 x edge travel / 70): `set_keyframes_tool {"timeline_clip_id": "<card>", "property": "scale_x", "points": [{"seconds": 1.0, "value": <old_w>}, {"seconds": 1.55, "value": <new_w>, "ease": "ease_in_out_expo"}]}`, plus `scale_y`, `location_x`, `location_y`, and `corner_radius` (a pill going to a tile keeps its height locked and its radius from full to 22 % of its side; a panel's radius eases 44 to 36 px).
3. Old content (a clip) fades out in the first 12 f (0.2 s) `ease_in_out_sine`; a surviving title flies to its header spot and 0.6 scale on the same curve, dropping to 55 % opacity while it is faster than 20 px/f so it lands sharp.
4. New content enters 8 f (0.13 s) after the speed peak with a 2-4 f (0.03-0.07 s) stagger: `set_keyframes_tool {"property": "alpha", "points": [{"seconds": 1.35, "value": 0}, {"seconds": 1.55, "value": 1}]}` per child.
5. A backdrop dims linearly over the same frames: `alpha` 0 to 0.5 on a black clip. `add_sfx_tool {"recipe": "pop", "at_seconds": 1.0, "gain_db": -22}`.

## Timing & taste rules

- cinetic's timing (60 fps): Morph 30-36 f (0.60 s) (ease_in_out_expo), edges <= 70 px/f. Old content out 12 f (0.20 s) (ease_in_out_sine); title FLIP to 0.6 scale; new content +8 f (0.13 s) after the peak, 2-4 f (0.07 s) stagger; backdrop dim linear over the morph. Outline retract 15 f (0.25 s). Content swap: out 18 f (0.30 s) (ease_in_cubic), resize 20 f (0.33 s) (ease_out_expo), in 18 f (0.30 s) (ease_out_expo).
- Morph 30-36 f (0.5-0.6 s) on ease_in_out_expo; slow first 5 f, speed peak near 40 %, long settle.
- Old content out in 12 f (0.2 s); new content enters 8 f (0.13 s) after the peak with 2-4 f (0.03-0.07 s) stagger.
- Fastest edge under 70 px/f; lengthen the move instead of speeding up.
- Pill to tile: height locked, radius from fully round to 22 % of the side.

## Sound for it

One pop or ui_tap at -22 dB on the press frame; the morph itself is silent.

## Common mistakes

- The size change comes from content or a drag: that is a live reflow.
- The two states have no visual relation, so there is no shared shape to morph.
- Swapping two elements with a crossfade and calling it a morph.
- Avoid when: The size change comes from content or a drag (live reflow), or the two states have no visual relation.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-ui-container-morph.mp4` (1280x720p60, a full-frame Solid_Color title (add_title_tool with a space and background_color) scaled to a 0.5 x 0.09 pill, then scale_x 0.5 to 0.3 and scale_y 0.09 to 0.42 over 1.0-1.55 s on ease_in_out_expo, a black Solid_Color backdrop alpha 0 to 0.5, a Deployed kinetic title fading in at 1.35 s, pop at 1.0 s over a 3 s test-pattern UI): the white pill widens into a rounded tile centred on the frame with the picture dimming and the word appearing after the peak; the morph is one object with no swap; the rounded corners go slightly elliptical while stretching; watch judge 1.8/10 (stand-in UI).

Found when rendering it (apply before building):

- Step 2: set_keyframes_tool refuses corner_radius (only alpha, location_x, location_y, rotation, scale_x, scale_y, volume are accepted); set a static radius with set_clip_properties_tool {"timeline_clip_id": ..., "properties": {"corner_radius": 0.3}}. The radius is applied before the scale, so a non-uniform stretch makes the corners elliptical (visible on the pill ends); pick one radius that suits both shapes instead of easing it from full to 22 %.
- Step 1: add_title_tool with text " " and background_color makes a full-frame solid (template Solid_Color, scale 1, centred); the card is that clip scaled down (scale_x 0.5, scale_y 0.09 for a pill), not a block of the stated size. Use two Solid_Color titles, one #000000 for the dimmer (alpha 0 to 0.5) and one for the card.
- Step 4: the content child worked as a separate kinetic title (stagger_seconds 0, ink #101018 for contrast on the light card) placed with position_seconds 0.35 s into the morph, rather than as an alpha keyframe on a clip.

Translated from cinetic's technique library (`ui-container-morph`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
