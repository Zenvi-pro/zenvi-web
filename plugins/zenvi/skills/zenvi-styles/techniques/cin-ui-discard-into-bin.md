---
id: cin-ui-discard-into-bin
kind: technique
summary: "When the old way should be thrown out, icons are tossed into a bin that rises to catch them, then peek back once."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_emoji_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [playful, decisive, comic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-clutter-pileup-strip, cin-mi-spinner-to-check, shot-attention-bounce]
avoid_with: [cin-ui-stalled-state, shot-blur-slide]
needs: []
drawn: cinetic
---

# Toss into a bin with one rebound

cinetic `ui-discard-into-bin` · UI choreography · signature · energy high · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Icons or chips are thrown into a container that rises in to catch them, drop through its mouth and peek back out once before settling.

Use when: A comic or decisive 'throw the old way away' beat: replacing old tools, clearing clutter, deleting the problem.

## Build it in Zenvi

1. Layer order bottom to top: the bin body on track 2, the thrown items on track 3, the bin front lip on track 4, so items disappear behind the lip with no mask. Bin: `add_emoji_tool {"emoji": "wastebasket", "size": 0.3, "screen_position": "bottom_center", "position_seconds": 0.0, "duration_seconds": 2.5, "track": "2"}`; put the same bin graphic's lower half on track 4.
2. The bin rises 160 px (0.15 of height) over 24 f (0.4 s): `set_keyframes_tool {"property": "location_y", "points": [{"seconds": 0.0, "value": 0.15}, {"seconds": 0.4, "value": 0, "ease": "ease_out_expo"}]}` on both bin layers.
3. Each item (an icon, one clip each): rise about 260 px (0.24 of height) over 24 f (0.4 s) `ease_out_expo`, hang 3 f (0.05 s), fall about 340 px (0.31) over 22 f (0.37 s) `ease_in_cubic`, `rotation` to +-15, `location_x` to the mouth on `ease_in_out_sine`. Stagger items 5 f (0.08 s).
4. Rebound, 6 f (0.1 s) after the last entry: the contents peek up 24 px (0.022 of height) on `ease_out_back` and settle within 16 f (0.27 s); the rim squashes `scale_y` 0.97 and back.
5. `add_sfx_tool {"recipe": "impact_thud", "at_seconds": <rebound>, "gain_db": -10, "pitch": -4}`.

## Timing & taste rules

- cinetic's timing (60 fps): Bin rise 160 px, 24 f (0.40 s) (ease_out_expo). Item rise ~260 px, 24 f (0.40 s) (ease_out_expo); hang 3 f (0.05 s); fall ~340 px, 22 f (0.37 s) (ease_in_cubic), <= 70 px/f; tilt +-15 deg. Chain: 60 f (1.00 s) per chip (ease_in_cubic along the path), 5 f (0.08 s) lag. Rebound at +6 f (0.10 s), ~24 px, ease_out_back, settled in 16 f (0.27 s).
- Bin rises 160 px in 24 f (0.4 s); items rise 260 px in 24 f, hang 3 f, fall 340 px in 22 f (0.37 s), never above 70 px/f entering.
- Tilt +-15 degrees, sign random per item; stagger 5 f (0.08 s).
- One rebound only: about 24 px, settled inside 16 f (0.27 s); this counts as one of the film's two spring landings.
- Hold the settled bin 36 f (0.6 s) before leaving.

## Sound for it

A low thud (impact_thud, pitch -4, about 60 to 30 Hz) on the rebound frame; light whoosh_short at -22 dB under each toss.

## Common mistakes

- Serious, calm or enterprise tone: this beat is comic.
- Spending a third spring landing in the same film: keep it to two.
- Items drawn in front of the bin lip: they must go behind it to read as dropping in.
- Avoid when: Serious, calm or enterprise tone, or the film has already used its two spring landings.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-discard-into-bin`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
