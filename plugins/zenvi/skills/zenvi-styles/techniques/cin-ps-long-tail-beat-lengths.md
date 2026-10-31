---
id: cin-ps-long-tail-beat-lengths
kind: technique
summary: "When a cut list feels like a slideshow: mix core beats, quick connectors and one or two hero beats about 3x as long."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, snap_cuts_to_beats_tool, review_edit_tool]
pace: medium
mood: [uneven, alive, considered]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [accelerating-cut-length-ramp, cin-ps-four-sequence-launch]
avoid_with: [cin-ps-faster-each-repeat, cin-ps-fixed-ask-variable-answer]
needs: []
drawn: cinetic
---

# Long-tailed beat lengths

cinetic `ps-long-tail-beat-lengths` · Pacing and structure · workhorse · energy any · formats launch, walkthrough, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Beat lengths follow a long tail instead of an even grid: most beats sit near one median length, a few connective beats snap past at a third of it, and one or two hero beats run about three times as long, so the film never settles into a slideshow rhythm.

Use when: Launch films and walkthroughs of 15 s or more with eight or more beats, any cut list that came out evenly spaced, and deciding where the hero feature gets its time.

## Build it in Zenvi

1. Write the cut list in seconds before placing anything, from a median M of 60-72 f (1.0-1.2 s): core beats 0.75-1.33x M (about 60 %: features, claims, answers); connectors 0.25-0.5x M, never under 24 f (0.4 s) (about 20 %: a punch-in insert, a whip, a one-word card); long beats 1.5-2x M (10-15 %); one or two hero beats 2.5-3x M, capped at 180 f (3 s), in the back half before the sign-off.
2. Example (28.75 s at 120 BPM): 75, 60, 30, 75, 120, 45, 60, 75, 30, 75, 60, 45, 105, 60, 30, 180, 75, 45, 30, 180, 90, 60 f, then a 120 f lockup. In seconds: 1.25, 1.0, 0.5, 1.25, 2.0, 0.75, 1.0, 1.25, 0.5, 1.25, 1.0, 0.75, 1.75, 1.0, 0.5, 3.0, 1.25, 0.75, 0.5, 3.0, 1.5, 1.0, 2.0.
3. Place each beat: `add_clip_to_timeline_tool {"file_id": "<shot_i>", "position_seconds": "<running sum>", "duration_seconds": 1.25, "track": 1}` for each; put one or two connectors immediately before each hero beat so it lands as a release; never three neighbouring beats within 10 % of each other.
4. Align cuts to the grid: `snap_cuts_to_beats_tool {"track": 1, "grid": "half_beats", "mode": "roll"}`.
5. Check the shape with `review_edit_tool {"pace": "medium"}`: max/M 2.5-3.0, min/M 0.16-0.5, no beat longer than 3 s, coefficient of variation 0.4-0.8. Fill each hero beat with continuous action (a camera journey or a UI event at least every 40 f, 0.67 s), never a long hold.

## Timing & taste rules

- cinetic's timing (60 fps): M = 60-72 f (1.20 s). Connective beats 24-36 f (0.60 s) (never under 24 f (0.40 s)); core 0.75-1.33x M; long 1.5-2x M; hero 2.5-3x M, at most 180 f (3.00 s) and at most 2 per film; coefficient of variation 0.4-0.8. Example 28.75 s cut at 120 BPM: 75, 60, 30, 75, 120, 45, 60, 75, 30, 75, 60, 45, 105, 60, 30, 180, 75, 45, 30, 180, 90 and 60 f (1.00 s), then a 120 f (2.00 s) lockup (M 60, max/M 3.0, CV 0.56).
- Median M = 60-72 f (1.0-1.2 s). Connective beats 24-36 f (0.4-0.6 s), never under 24 f; core 0.75-1.33x M; long 1.5-2x M; hero 2.5-3x M, at most 180 f (3 s) and at most 2 per film.
- Coefficient of variation 0.4-0.8; an evenly spaced cut list scores about 0.1 and reads as a slideshow.
- Beats under 42 f (0.7 s) carry no readable text (36 f + 6 f per word).
- Example CV 0.56, M 60, max/M 3.0.

## Sound for it

None of its own; put the music's hits on the hero beats' first frames.

## Common mistakes

- Polyrhythm loops and fixed-length ask cycles, where equal length is the point.
- Stings under about 8 s: too few beats for a distribution.
- Filling a hero beat with a long hold: it needs continuous action.
- Avoid when: Polyrhythm loops and fixed-length ask cycles, where equal length is the point; stings under about 8 s, which have too few beats for a distribution; accelerando runs, which set their own length ratios.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-long-tail-beat-lengths`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
