---
id: cin-dn-answer-card-bars
kind: technique
summary: "When a product answers with data: a small card of bars grows in sequence, then one line states the key figures."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [clear, helpful]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [prompt-bar-typing-hero, shot-type-and-filter]
avoid_with: [cin-dn-bar-sweep-lit-caps]
needs: []
drawn: cinetic
---

# Mini bar-chart answer card

cinetic `dn-answer-card-bars` · Data and numbers · workhorse · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Inside a chat or a panel, an answer arrives as a small card of labelled horizontal bars that grow in sequence, followed by a one-line insight that states the key figures.

Use when: An AI or analytics product answers a question with data; a walkthrough needs one piece of quantitative proof.

## Build it in Zenvi

1. `add_motion_block_tool {"block": "chart_build", "position_seconds": 2.0, "duration_seconds": 6.0, "placement": "over_video", "params": {"kind": "bar", "values": ["62", "41", "27", "18"], "labels": ["Search", "Direct", "Email", "Social"], "highlight": 0, "suffix": "%", "plate": "glass", "caption": "Search drives 62 %, Direct 41 %"}}`.
2. The card rises 24 px: `set_keyframes_tool {"timeline_clip_id": "<chart>", "property": "location_y", "ease": "ease_out_cubic", "points": [{"seconds": 2.0, "value": 0.022}, {"seconds": 2.4, "value": 0}]}`, `alpha` 0 to 1 over 0.17 s.
3. Only the row the insight is about takes the accent (`highlight`), the rest stay neutral; each bar grows 20 f (0.33 s) at 5 f (0.08 s) apart, the group landing within 30 f (0.5 s).
4. The insight types 6 f (0.1 s) after the last bar lands: `add_kinetic_title_tool {"text": "Search drives 62 % of signups", "style": "documentary", "animation": "typewriter", "emphasis": ["62"], "position_seconds": 2.9, "duration_seconds": 3.0, "y": 0.82}`.
5. Optional punch-in cut to the highlighted row: `set_keyframes_tool` `scale_x/y` 1.0 to 2.4 on a hard cut at the next eighth, then a sideways `location_x` pan decaying over 30 f (0.5 s).
6. `add_sfx_tool {"recipe": "typing_burst", "at_seconds": 2.9, "gain_db": -22}`.

## Timing & taste rules

- cinetic's timing (60 fps): Rows 20 f (0.33 s) each on ease_out_cubic at a 5 f (0.08 s) stagger (the group lands within 30 f (0.50 s)). The insight types over ~40 f (0.67 s), starting 6 f (0.10 s) after the last bar. Card visible ~180 f (3.00 s) under a 2% breath. Optional 2.4x punch-in cut, then a pan from 20 px/f decaying 0.89 per frame (settled in about 30 f (0.50 s)).
- Card rise 24 px with opacity over 10 f (0.17 s); rows 20 f (0.33 s) each at a 5 f (0.08 s) stagger.
- Keep bar tracks at or under 300 px, or stretch the grow to track/15 frames so the tip stays at or under 70 px/f.
- Insight types over about 40 f (0.67 s), figures in a heavier weight; card visible about 180 f (3 s) under a 2 % breath.
- Punch-in 2.4x on the next eighth with a pan starting at 20 px/f and settling in about 30 f.

## Sound for it

A quiet typing_burst for the insight line, -22 dB; the bars growing get none.

## Common mistakes

- More than 6 rows, where the group outruns 30 f and labels shrink.
- Bars that carry no real meaning.
- Colouring every bar: only the row the insight is about takes the accent.
- Avoid when: More than 6 rows, where the group outruns 30 f and the labels shrink; bars that carry no real meaning.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-dn-answer-card-bars.mp4` (1280x720p60, chart_build bar block (4 values, highlight 0, glass plate, over a flat card) 0.5-4.5 s with a 0.4 s rise and 0.17 s fade keyframed on the block, a documentary typewriter title at 1.4 s, typing_burst at 1.4 s): the card rises and fades in, bars grow and the first bar takes the accent at about 2.4 s, but the block carries its own default heading and big counter, the bars take about 1.4 s to land (not 0.5 s) and the typed insight at y 0.82 prints over the counter and the axis labels; watch judge 4.8/10. Does not look right yet with today's tools (see the fixes).

Found when rendering it (apply before building):

- Step 1: pass title (and a short caption), otherwise the block prints its default heading Hours saved per person, each month; the caption is a small badge at the highlighted bar (a 30-character sentence overflows it), keep it to a few words such as Search leads.
- Step 3: the chart_build block has no timing parameters: its bars grow one after another over roughly 1.4 s from the block start and the accent colour arrives about 0.9 s after the last bar, not 5 f apart with the group inside 0.5 s. Say so, and time the title by the block (type the insight at about block start + 1.9 s).
- Step 4: the block also shows a big counter bottom left; a typed title at y 0.82 collides with it and with the axis labels. Put the insight above the card (y about 0.08) or set the block plate to none and leave the bottom free; check with inspect_timeline_tool.
- Step 2: location_y and alpha keyframes on the block need timeline_seconds in the points when the block does not start at 0 (here at 0.5 s); the card has to be positioned at base 0 (centre gravity), so 0.022 to 0 is the right base.
- Step 6: typing_burst picked a recorded typing sound that ran past the end of the picture ('Its last 0.54 s would run past the picture', so the tool trimmed and faded it); give it a duration (add_sfx_tool duration) so it ends with the typing.

Translated from cinetic's technique library (`dn-answer-card-bars`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
