---
id: cinematic-aspect-ratio-reveal
kind: technique
summary: When an opener or payoff should feel like a curtain - bars open from a slit to 2.39:1, or widen to full frame.
categories: [travel-cinematic-montage, movie-game-trailer, wedding-event-film, real-estate-tour, brand-story-corporate, automotive-ad]
tools: [add_shape_mask_tool]
pace: calm
mood: [grand, cinematic, expansive]
aspect: ["16:9", "2.39:1"]
pairs_with: [cinematic-anamorphic-letterbox, cinematic-title-sequence, cinematic-push-in, cinematic-montage-rhythm]
avoid_with: [cinematic-whip-cut]
needs: [mask-keyframe-easing]
---

# Aspect-ratio reveal

## What it is

The frame's shape changes on screen: black bars open from a thin slit to the 2.39:1 band on the
first shot, or the band widens to full 16:9 at the payoff (the "IMAX" moment). Shines on a wide
landscape opener, a venue reveal, the hero product or the couple's first look.

## Build it in Zenvi

`add_shape_mask_tool` `{"clip_ids": ["<first shot>"], "shape": "rectangle", "width": 2.0,
"height": 1.0, "feather": 0, "keyframes": [{"seconds": 0, "grow": -0.49}, {"seconds": 0.6, "grow": -0.49},
{"seconds": 2.4, "grow": -0.128}, {"seconds": 3.6, "grow": -0.128}, {"seconds": 4.6, "grow": 0}]}`
- `grow` moves every edge by the same amount, so `width: 2.0` keeps the box wider than the frame
  while the top and bottom open (with `width` 1.0 it opens as a shrinking box, the first test).
- -0.49 = a slit, -0.128 = the 2.39:1 band, 0 = full frame. All keyframes must lie inside the clip.
- Later shots then carry static 2.39 bars (`cinematic-anamorphic-letterbox`).

## Timing & taste rules

- Hold the slit 0.4-0.8 s, open over 1.5-2.5 s, on the first downbeat or the first chord.
- Shape keyframes interpolate linearly (no ease option yet, `mask-keyframe-easing`); use more
  points (slow - fast - slow) to fake an ease-out.
- One reveal per piece; a second one at the climax (band -> full frame) at most.

## Sound for it

A soft `reverse_swell` or `whoosh_long` (-16 dB) under the opening, or the music's first swell.

## Common mistakes

- Opening on a shot shorter than the keyframes (the tool refuses keyframes outside the clip).
- Bars that then disappear on the next shot (keep the band).

## Verified

2026-10-28, `tech/aspect-ratio-reveal` (sunrise aerial, 5 s 720p24). Watch judge (abs): overall
4.4, "an aspect ratio expander over a sweeping landscape is a classic opener that works well
visually", but "linear, mechanical easing" - hence the extra-points rule and `needs`. Used in
the travel showcase opener.
