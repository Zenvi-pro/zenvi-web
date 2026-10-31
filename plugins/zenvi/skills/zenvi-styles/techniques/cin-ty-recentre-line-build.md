---
id: cin-ty-recentre-line-build
kind: technique
summary: "When a headline builds at speaking pace: words join one at a time and the line stays centred on every frame."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [spoken, fluid]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-ty-reading-order-exit, shot-blur-slide]
avoid_with: [cin-ty-inplace-light-up-beats]
needs: [live-recentring-text-line]
drawn: cinetic
---

# Re-centring line build

cinetic `ty-recentre-line-build` · Typography in motion · workhorse · energy medium · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Words or typed glyphs join a centred line one at a time while the whole line glides sideways so it is centred on every frame.

Use when: Speaking-pace builds, stat rows that widen as words arrive, centred typed headlines, any line whose final width is unknown while it builds.

## Build it in Zenvi

1. Lay the line out as one word per title so each word has its own clip: `add_title_tool {"text": "One", "template": "Standard_1", "position_seconds": 1.0, "duration_seconds": 3.5, "track": "3"}`, then `"prompt"`, `"ships"`, `"the film."` on tracks 4, 5, 6 with `position_seconds` 1.45, 1.9, 2.35 (a new word every 27 f, 0.45 s).
2. Each word drops in: `set_keyframes_tool {"timeline_clip_id": "<word_k>", "property": "location_y", "ease": "ease_out_expo", "points": [{"seconds": <land_k>, "value": -0.04}, {"seconds": <land_k + 0.3>, "value": 0}]}` (0.35 em, 18 f) and `alpha` 0 to 1 over 0.1 s.
3. Re-centre: for every word already placed, add `location_x` keyframes that shift it by half the new word's width at each landing, `ease_in_out_sine`, 0.45 s long (never over 280 px, 0.15 of width, per shift).
4. After the last word add a 0.3 px/f drift: `location_x` +0.003 over 1.5 s.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 2.35, "gain_db": -20}` on the last word only.

Fallback: If the shifts are too fiddly, use add_kinetic_title_tool on the full line with animation rise and stagger_seconds 0.45: the line is centred from the start but does not glide.

## Timing & taste rules

- cinetic's timing (60 fps): A new word every 26-36 f (0.43-0.6 s); ease_out_quart re-centre (peak about 7% of the shift per frame, 97% by 27 f (0.45 s)), so shifts up to 280 px stay under 20 px/f; word drop 18 f (0.30 s) ease_out_expo; pre-solved: 1.3 f (0.02 s) per character, 5 f (0.08 s) fade, 90 px glide over 24 f (0.40 s) ease_out_expo; residual drift 0.3 px/f.
- A new word every 26-36 f (0.43-0.6 s); word drop 18 f (0.3 s) ease_out_expo from -0.35 em, opacity over 6 f (0.1 s).
- Re-centre shift under 20 px/f; no word may force a shift above about 280 px, split the line instead.
- Pre-solved alternative for a short typed line: fade each character in over 5 f at 1.3 f apart while the line glides 90 px (0.047 of width) in 24 f (0.4 s) so it lands centred with its last glyph.
- Residual 0.3 px/f drift after the last word; the line never freezes.

## Sound for it

A soft ui_tap on the last word only, -20 dB; never one per word.

## Common mistakes

- Shifts over about 280 px per word; the line sweeps instead of settling.
- Left-aligned layouts, where there is nothing to re-centre.
- A line that must keep an anchored element still: use in-place light-up instead.
- Avoid when: Shifts over about 280 px per word (split the line instead); left-aligned layouts; a line that must keep an anchored element still (use ty-inplace-light-up-beats).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-recentre-line-build`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
