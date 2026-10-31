---
id: cin-ps-oner-morph-chain
kind: technique
summary: "When the film should never cut: every scene grows out of an element already on screen, via blur-dip morphs."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [duplicate_clips_tool, add_effect_tool, update_effect_tool, set_keyframes_tool, apply_matched_dissolve_tool]
pace: medium
mood: [fluid, seamless, clever]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [t101, shot-match-iris-window, shot-ui-to-brand-morph]
avoid_with: [cin-ps-four-sequence-launch, kcut-hit-fx]
needs: [svg-icon-morph-chain]
drawn: cinetic
---

# Oner through a morph chain

cinetic `ps-oner-morph-chain` · Pacing and structure · signature · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The whole film plays as one continuous shot, every new scene growing out of an object already on screen, with no hard cuts at all.

Use when: Multi-step workflows and multi-app stories, or any film where the viewer should never have to re-orient.

## Build it in Zenvi

1. Plan one handoff object per boundary (word gap, box, dot, button, icon, card, pill): about 3.6 morphs per 10 s; beats median 72-144 f (1.2-2.4 s), minimum 23-34 f (0.38-0.57 s), maximum 194-410 f (3.2-6.8 s).
2. At each boundary, duplicate the handoff element onto a top track: `duplicate_clips_tool {"timeline_clip_ids": ["<handoff>"], "to_track": 6}`. Blur it 0 to 12 px while fading it to 40 % opacity over the next scene's stage colour: `add_effect_tool {"effect": "Blur", "timeline_clip_id": "<dup>"}` and `update_effect_tool` blur 0 to 12 across 10-14 f (0.17-0.23 s), `set_keyframes_tool` `alpha` 1 to 0.4. Swap the world beneath, then clear the blur; luminance never dips toward black.
3. Move the element to its new slot: `set_keyframes_tool {"timeline_clip_id": "<dup>", "property": "location_x", "mode": "replace", "points": [{"seconds": 4.0, "value": 0}, {"seconds": 4.083, "value": 0.02, "ease": "ease_in_cubic"}, {"seconds": 4.25, "value": "<new_x>", "ease": "ease_out_expo"}]}`, the same for `location_y` and `scale_x/y`: 5 f (0.08 s) to break loose, then 10-16 f (0.17-0.27 s) of ease_out_expo.
4. For two clips that share a camera move, join them with `apply_matched_dissolve_tool {"clip1_id": "<a>", "clip2_id": "<b>", "duration": 0.4}`.
5. Allow at most one masked cut, hidden behind a 3-6 f (0.05-0.1 s) blur dip at a motion peak.

Fallback: Exact shape morphing (a box to a pill with radius) needs a vector morph; fake it with a scale and alpha crossfade between two matched clips.

## Timing & taste rules

- cinetic's timing (60 fps): About 3.6 morphs per 10 s; beats median 72-144 f (2.40 s), minimum 23-34 f (0.57 s), maximum 194-410 f (6.83 s); each morph 5 f (0.08 s) ease_in_cubic plus 10-16 f (0.27 s) ease_out_expo; world swap 10-14 f (0.23 s) under the held element.
- About 3.6 morphs per 10 s; each morph 5 f (0.08 s) ease_in_cubic plus 10-16 f (0.17-0.27 s) ease_out_expo.
- World swap 10-14 f (0.17-0.23 s) under the held element; blur 0 to 12 px and opacity to 40 %.
- At most one masked cut per film, behind a 3-6 f blur dip at a motion peak.
- No hard cuts at all otherwise.

## Sound for it

Soft whoosh_short or swish_airy at -16 dB on each morph; no hit sounds, as there are no cuts.

## Common mistakes

- Films that use polarity cuts as punctuation.
- Footage-based shots that cannot share elements.
- Letting luminance dip toward black on the handoff.
- Avoid when: Films that use polarity cuts as punctuation, or footage-based shots that cannot share elements.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-oner-morph-chain`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
