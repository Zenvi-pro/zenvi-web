---
id: shot-doc-park-pill-deal
kind: technique
summary: "When findings are read out one by one: the source document parks left and pills are dealt, each with its caption."
categories: [saas-app-launch, video-essay-explainer, tech-review, animated-explainer, news-short-vertical-explainer]
tools: [set_keyframes_tool, add_title_tool, add_kinetic_title_tool, kinetic_captions_tool, add_shape_mask_tool, add_sfx_tool]
pace: calm
mood: [thoughtful, trustworthy, measured]
aspect: ["16:9", "9:16"]
pairs_with: [kinetic-vo-captions, T047, T062]
avoid_with: [shot-stack-press-count, shot-card-stack-fan]
needs: [auto-sized-pill-title, word-highlight-box]
---

# Doc parks left, pills are dealt

## What it is
The source document does not fade out. It slides left until about 35 % of its width shows (scaled to 0.92, anchored on its left
edge) and keeps scrolling very slowly, so it reads as "being read". On the right, three outlined pills arrive at the pace of
the narration (one per sentence); under each, its caption lights up word by word, then clears before the next pill. After each
pill lands, the matching sentence in the document is highlighted. Conclusions that grow out of a visible source.

## Build it in Zenvi
1. Document = a screenshot/recording clip on the base track. `set_keyframes_tool` on `location_x` (0 to -0.30, `ease_in_out_cubic`, 0.54 s from 0.18 s) and
   `scale_x`/`scale_y` (1 to 0.92) with the `origin_x` kept left (`origin_x`/`origin_y` keyframes); then a slow `location_y` drift
   over the whole shot (about 0.7 px/frame at 480 px width, never above 3 px/frame).
2. Pills: no pill shape tool (`needs: auto-sized-pill-title`); closest is `add_title_tool` with a boxed template and `background_color`, or
   `add_kinetic_title_tool {"text": "<conclusion>", "style": "documentary", "animation": "pop", "position_seconds": 0.78, "duration_seconds": 4.5, "y": 0.3}`,
   one per conclusion at 0.78 s, 1.44 s, 2.1 s (every 1.27 s in the card: set to the narration's sentence length).
3. Captions: `kinetic_captions_tool` with `cues` for each sentence, `style: "documentary"`, each ending before the next pill lands.
4. Highlight on the document: a yellow clip with `add_shape_mask_tool` keyframes (`keyframes` growing the rectangle left to right over 6 f)
   at the evidence line; fallback: skip it (`needs: word-highlight-box`).
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 0.78, "gain_db": -18}` per pill.

## Timing & taste rules
- Deal interval = one spoken sentence, about 1.27 s (38 f); under 0.4 s the captions cannot finish.
- Park finishes before the first pill (0.18-0.72 s); overlap makes the first beat muddy.
- Pill: opacity over 6 f (out-quad), position and scale (y 14 to 0, 0.94 to 1) over 11 f with overshoot: seen first, then settled.
- Caption starts 9 f after the pill lands, fills its darkness over 70 % of its time and holds 30 % full; fades 5 f before the next pill.
- Visible part of the document at least 25 %, else it is decoration; at most 3 pills (a fourth runs out of time: shorten the sentences).
- Auto-scroll is continuous, never a looping modulo (it jumps back on non-periodic content).

## Sound for it
A soft `pop` per pill (-18 dB); the narration carries the rest; `ui_tap` for the highlight sweep if audible.

## Common mistakes
- Fading the document out (the conclusions lose their source).
- Captions of two pills on screen at once; pills and park overlapping.
- Pill positions hard-coded against one document width.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/ui-entrance/doc-park-left-pill-deal.md` (Apache-2.0; see ../NOTICE).
