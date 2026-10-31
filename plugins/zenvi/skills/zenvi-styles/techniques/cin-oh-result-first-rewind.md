---
id: cin-oh-result-first-rewind
kind: technique
summary: "When the output is rich at a glance: open on the finished result, hold, rewind to the empty start, then play forward."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, freeze_frame_tool, reverse_clip_tool, set_clip_speed_tool, speed_ramp_tool, fade_clip_tool, add_sfx_tool]
pace: medium
mood: [confident, playful, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [screen-capture-zoom-onto-the-number, shot-ui-strip-away-outro, shot-type-and-filter]
avoid_with: [cin-oh-pile-up-freeze-turn]
needs: []
drawn: cinetic
---

# Finished result first, then rewind

cinetic `oh-result-first-rewind` · Opening hook · accent · energy medium · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The film opens on the finished end state at its most impressive, holds for a beat, then visibly rewinds every element back to the empty start, where the story begins playing forward.

Use when: Walkthroughs and feature films whose output is visually rich and readable at a glance.

## Build it in Zenvi

1. Hold the end state: `add_clip_to_timeline_tool {"file_id": "<recording>", "position_seconds": 0, "start_seconds": 11.0, "end_seconds": 12.0, "track": 1}` with a +2.5 % breath: `set_keyframes_tool {"timeline_clip_id": "<hold>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 0.67, "value": 1.025, "ease": "ease_in_out_sine"}]}` (and `scale_y`); hold 40 f (0.67 s).
2. The rewind: a second placement of the same recording, `start_seconds` 3.0 to `end_seconds` 11.0 (at most ~120 f / 2 s of build), at `position_seconds` 0.67, then `reverse_clip_tool {"timeline_clip_id": "<rewind>", "mode": "reverse"}` and `set_clip_speed_tool {"clip_id": "<rewind>", "target_duration_seconds": 0.7}` (36-48 f, 0.6-0.8 s; peak about 8x).
3. For a long build, soften the ends so it rushes rather than jerks: `speed_ramp_tool {"clip_id": "<rewind>", "preset": "velocity", "fast": 8, "slow": 2, "ramp_seconds": 0.2, "hold_seconds": 0.1, "audio": "mute"}` instead of the flat retime.
4. Fade anything too fast to read: `fade_clip_tool {"clip_id": "<rewind>", "fade_out_seconds": 0.2}`.
5. Play the walkthrough forward from the empty start: the original recording from 0 s at 1.37 s. `add_sfx_tool {"recipe": "reverse_swell", "at_seconds": 0.67, "gain_db": -16}` under the rewind and `{"recipe": "mouse_click", "at_seconds": 1.37, "gain_db": -12}` on its last frame.

Fallback: Real recordings reverse cleanly; for motion blocks, render the block and reverse the file. Anything unreadable at 8x fades rather than travels.

## Timing & taste rules

- cinetic's timing (60 fps): Hold 40 f (0.67 s); rewind 36-48 f (0.80 s) on ease_in_out_sine (peak about 8x real time, at most about 120 f (2.00 s) of build); forward play from the next beat.
- Hold the result 40 f (0.67 s) with a +2.5 % breath.
- Rewind 36-48 f (0.6-0.8 s) on a smooth ease; peak ~8x real time, at most ~120 f (2 s) of build rewound.
- Rewind rate = 2.86 x build / R; for a longer build, start the rewind from a partly built state.
- Elements that would pass 60 px/f, and readable text past 20 px/f, fade instead of travelling.
- Forward play starts on the next beat after the click.

## Sound for it

A short filtered `reverse_swell` under the rewind, a `mouse_click` on its last frame, then the forward walkthrough's own sounds.

## Common mistakes

- An end state that needs explaining, or more than ~30 state changes: the rewind turns to mush (avoid_when).
- A rewind longer than ~0.8 s: it reads as a slow reverse clip.
- Leaving unreadable text at 8x on screen: fade it.
- Avoid when: An end state that needs explaining, or more than about 30 state changes (the rewind turns to mush).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-result-first-rewind`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
