---
id: shot-text-column-converge
kind: technique
summary: "When a feature list must end in a reveal: two words face off at the edges, cut through terms, then slide together once."
categories: [kinetic-type-motion-design, saas-app-launch, product-launch-film, tech-review, brand-story-corporate]
tools: [add_kinetic_title_tool, trim_clip_tool, get_clip_properties_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [technical, understated, reveal]
aspect: ["16:9", "1:1"]
pairs_with: [kinetic-word-rotator, kinetic-counter, shot-blur-slide]
avoid_with: [kinetic-beat-strobe, shot-outline-word-fill, kinetic-typewriter]
needs: []
---

# Two words converge (the "NEW x list" reveal)

## What it is
A fixed word sits at the left edge ("NEW") and a changing word at the right edge. The right word hard-cuts through eight or nine
features at uneven intervals; the viewer thinks it is a rotating caption. Only when the last word (the product name) lands do
both slide to the middle in one move and lock into a single phrase, and a small italic line surfaces below. The suspense is
the pinned distance, so the close-up lands as a reveal. Recap and launch outros; version reveals.

## Build it in Zenvi
All native. A mono face makes the final width a plain character count: the right word is one title per term (hard-cut, no
animation), the left word one long title.
```json
add_kinetic_title_tool {"text": "NEW", "style": "documentary", "animation": "fade", "text_size": 0.05, "y": 0.5, "ink": "#8a8f9c", "position_seconds": 0, "duration_seconds": 5.2}
add_kinetic_title_tool {"text": "captions", "style": "documentary", "animation": "fade", "stagger_seconds": 0, "text_size": 0.05, "y": 0.5, "position_seconds": 0, "duration_seconds": 0.53}
(one more per term at its hold: 0.4 s, 0.3 s, 0.27 s, 0.23 s, 0.27 s, 0.33 s, 0.4 s; the last, the product name, stays to the end)
get_clip_properties_tool {"timeline_clip_id": "<NEW>"}      (read the base location x0, and the receipt box width for the final spacing)
set_keyframes_tool {"timeline_clip_id": "<NEW>", "property": "location_x", "ease": "ease_in_out_cubic", "points": [{"seconds": 3.5, "value": <x0>}, {"seconds": 4.7, "value": <x0 + dx>}]}
(the same for the last word with the mirrored dx so the gap ends exactly one space wide; dx from the receipts' box widths)
add_kinetic_title_tool {"text": "craft the shot.", "style": "documentary", "animation": "fade", "text_size": 0.03, "y": 0.58, "position_seconds": 5.3, "duration_seconds": 1.2, "stagger_seconds": 0}
add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 0.53, "gain_db": -22}      (one per term, seed varied)
```
Place the left word's left edge and the right word's right edge at equal margins (about 32 % of the frame width: 412/1280 in the source).
Right-align the right word on its edge, whatever its length. A title lasts at least 0.4 s: for the shorter holds place the title at 0.4 s and cut its end back with `trim_clip_tool` (`edge: "right"`, `at_seconds`), without overlapping the next term.

## Timing & taste rules
- Terms cut with no animation, uneven holds of 7-16 frames (16, 12, 9, 8, 7, 8, 10, 12 in the source): even holds read as a metronome, under 7 frames cannot be read.
- Pinned: the two edges do not move by even one pixel during the list; a gradual narrowing (the rejected version) gives away the reveal.
- One slide only, 36 frames (1.2 s) with an ease-in-out cubic, 10 frames after the last term has settled; under 24 frames bounces into place, over 50 drags.
- Final spacing: exactly one space (monospace: 0.6 em + tracking per character); no overlap, no gap, no correction move afterwards.
- Small type (42 px on 1080p, about 4 % of the height): this is a spec list, not a slam; at 60 px+ use shot-outline-word-fill.
- The small italic line appears 18 frames after the lock, a 4-frame fade, no travel.
- Left word grey in the list and brightens to white during the slide; each term gets a one-frame brightness blip on change (no longer than one frame).

## Sound for it
Nothing, or a faint key tick per term (-22 dB); a soft low hit as the phrase locks.

## Common mistakes
- Proportional font: the lock-up width cannot be calculated and the words overlap or leave a gap.
- A slow start that spoils the reveal; a second slide.
- Using it when the list has no payoff term.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/text-column-converge.md` (Apache-2.0; see ../NOTICE).
