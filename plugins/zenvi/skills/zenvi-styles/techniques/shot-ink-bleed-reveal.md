---
id: shot-ink-bleed-reveal
kind: technique
summary: "When a scene change should feel printed or written: the new scene seeps in from an ink drop with a feathered edge."
categories: [documentary-true-story, brand-story-corporate, fashion-beauty-ad, kinetic-type-motion-design, wedding-event-film]
tools: [add_shape_mask_tool, add_clip_to_timeline_tool, add_track_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [organic, tactile, literary]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-light-leak, cinematic-warm-nostalgia, kinetic-quote-card]
avoid_with: [shot-hidden-cut-masks, shot-glitch-tear-cut, shot-match-iris-window]
needs: [ink-edge-shader]
---

# Ink bleed reveal

## What it is
The new picture does not arrive, it is printed: it seeps out of a drop point through a whiskery, organic mask, quick and
slow in turns, eating the old scene like ink on absorbent paper. The medium is the metaphor. A slow change; not for dense
cuts.

## Build it in Zenvi
The whiskered noise edge is not available (`needs: ink-edge-shader`). Fallback: a soft round reveal.
1. Old scene on track 1, new scene on a track above from the start of the bleed.
2. `add_shape_mask_tool {"clip_ids": ["<B>"], "shape": "ellipse", "x": 0.4, "y": 0.5, "width": 1.0, "height": 1.78, "feather": 0.06,
   "keyframes": [{"seconds": 1.0, "grow": -1}, {"seconds": 1.5, "grow": -0.93}, {"seconds": 2.0, "grow": -0.5}, {"seconds": 2.4, "grow": -0.35},
   {"seconds": 3.4, "grow": 0.8}]}` (a first small drop at 0.5 s, then an uneven run: quick, near-stop, quick; the `feather`
   gives the wet halo).
3. The new scene develops inside: `set_keyframes_tool` `scale_x` / `scale_y` 1.035 to 1 over 2.6 s `ease_out`, landing exactly on 1.
4. Remove the mask when it has covered the frame: `add_shape_mask_tool {"clip_ids": ["<B>"], "remove": true}` (a leftover
   mask edge is never fully still).
5. `add_sfx_tool {"recipe": "tail_bloom", "at_seconds": 1.0, "gain_db": -22}` low and soft.

## Timing & taste rules
- Total 55-80 f of action (the card: radius 20 to 1450 px in 98 f, ease-out-quad) plus a still of at least 30 f.
- Radius speed varies by +-8 % (quick-slow), stopping at the end of the motion; a constant circle is a plain iris.
- Draw an ink edge 20-42 px ahead of the picture (outer 0.42 opacity, inner 0.86) and a 110 px wet halo at 0.12.
  With the plain mask, the feather does the halo.
- Old scene shows through the ragged holes briefly: fine as ink texture, but a face or a logo in the old scene reads as a
  glitch; avoid.
- Not combined with flash or shake. With a light leak at most 2 medium-based transitions in a film.
- Not for fast cutting; use a whip there.

## Sound for it
Barely any: a soft `tail_bloom` or a brush-like `paper` at -24 dB.

## Common mistakes
- A perfect round iris (no unevenness).
- Edge so wide and solid it reads as a burn hole.
- Leaving the mask on at the end.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/transition/print-texture-transitions.md` (Apache-2.0; see ../NOTICE).
