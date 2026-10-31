---
id: cin-oh-cropped-word-pull-back
kind: technique
summary: "When one charged word carries the copy: open inside it, first letter cropped, then pull back to the whole sentence."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [intriguing, editorial, calm]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-emphasis-scale, shot-blur-slide, cinematic-push-in]
avoid_with: [cin-oh-oversize-fly-then-small, cin-oh-macro-scramble-snap-out]
needs: []
drawn: cinetic
---

# Cut in mid-sentence, pull back to the line

cinetic `oh-cropped-word-pull-back` · Opening hook · accent · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The film opens inside one giant word, its first letter cropped by the frame edge as if cutting into a thought mid-sentence; after a beat the camera pulls back to reveal the whole sentence at reading size.

Use when: Copy-led launches built on one charged word, in calm-to-medium films.

## Build it in Zenvi

1. The whole sentence once at display size on a dark ground: `add_title_tool {"text": "We never stop building", "position_seconds": 0, "duration_seconds": 2.6, "font_scale": 2.2, "text_color": "#f5f1e8", "background_color": "#111111", "fit_text": false}`.
2. Frame the key word big: on that clip `set_keyframes_tool {"timeline_clip_id": "<line>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 3.2}, {"seconds": 0.6, "value": 3.2}, {"seconds": 1.53, "value": 1.0, "ease": "ease_in_out_sine"}]}` and the same on `scale_y`: hold f0-36 (0.6 s) then pull back over 56 f (0.93 s).
3. Offset so the first glyph is ~40 % cropped by the left edge: `location_x` `[{"seconds": 0, "value": 0.62}, {"seconds": 0.6, "value": 0.62}, {"seconds": 1.53, "value": 0.0, "ease": "ease_in_out_sine"}]`.
4. Settle at the start: `location_y` `[{"seconds": 0, "value": 0.03}, {"seconds": 0.2, "value": 0.0, "ease": "ease_out_expo"}]` (about 13 px), then a 0.3 px/f drift through the hold.
5. The other words are already part of the line, entering the frame as it widens; no fades. `add_sfx_tool {"recipe": "swish_airy", "at_seconds": 0.6, "gain_db": -18}`.

Fallback: Scale 3.2x of a title clip can look soft: set the text at the size of the big framing and scale it down to the reading size instead, or render the project at 2x for this shot.

## Timing & taste rules

- cinetic's timing (60 fps): Settle 12 f (0.20 s); hold 36 f (0.60 s); pull-back 56 f (0.93 s) from 3.2x to 1x on ease_in_out_sine (peak about 0.032 ln k per frame).
- Frame 0 is already settling: ~13 px vertical settle, then a 0.3 px/f drift through a 36-f (0.6 s) hold.
- Pull-back 56 f (0.93 s) from 3.2x to 1x on a smooth ease (peak ~0.032 ln k per frame).
- First glyph ~40 % cropped by the left edge; glyphs 600 px from the anchor stay under ~20 px/f.
- The sentence exists from the start: no fades on the neighbouring words.
- Display size about 120 px at 1080p once pulled back.

## Sound for it

Optional soft `swish_airy` as the pull-back starts (-18 dB); nothing on the opening frame.

## Common mistakes

- A short or ordinary key word: the crop will not intrigue (avoid_when).
- Fading the neighbouring words in as the camera widens: they must simply be there.
- Using it after another zoom-out opener (icon card, macro number): one pull-back per film.
- Avoid when: The key word is short or ordinary (the crop will not intrigue), or the film already opens on another zoom-out (icon card, macro number).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-cropped-word-pull-back`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
