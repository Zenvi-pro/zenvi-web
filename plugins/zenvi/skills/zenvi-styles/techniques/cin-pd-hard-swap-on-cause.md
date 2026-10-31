---
id: cin-pd-hard-swap-on-cause
kind: technique
summary: "When a choice changes the product, the view swaps in one frame on the click, with no crossfade, and numbers roll up."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [instant, causal, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-single-control-hero, cin-mi-guide-cursor-hover-press, shot-control-state-change]
avoid_with: [cin-pd-blur-resolve-load, cinematic-j-l-cut]
needs: []
drawn: cinetic
---

# Hard swap on the cause frame

cinetic `pd-hard-swap-on-cause` · Product demo · workhorse · energy medium · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

On a click or selection the product image, view or value changes in one frame with no crossfade, any price or count rolls up from just below its new value, and a physical card can hide the swap in a small 3D kick.

Use when: A choice changes the product instantly: a variant picker, filter, plan selector, theme switch, a canvas that appears whole on launch.

## Build it in Zenvi

1. Two states as two clips butted on one track, no transition: `add_clip_to_timeline_tool {"file_id": "<state_a>", "position_seconds": 0.0, "duration_seconds": 1.6, "track": "1"}` and `add_clip_to_timeline_tool {"file_id": "<state_b>", "position_seconds": 1.6, "duration_seconds": 2.0, "track": "1"}`. The cut is the cause frame.
2. Show the hover state 6 f (0.1 s) before the press, e.g. `add_motion_block_tool {"block": "cursor_path", "params": {"background": "<screen>", "points": [[<x>, <y>]], "clicks": true}}`, press at 1.6 s.
3. A price or count rolls from just under the new value: `add_motion_block_tool {"block": "counter", "params": {"values": ["<next - 7%>", "<next>"], "style": "odometer"}, "position_seconds": 1.6, "duration_seconds": 1.5}` (36-46 f = 0.6-0.77 s recount, digits roll about 14 f = 0.23 s).
4. Punch the swapped object 2 %: `set_keyframes_tool {"timeline_clip_id": "<state_b>", "property": "scale_x", "points": [{"seconds": 1.6, "value": 1.02}, {"seconds": 1.7, "value": 1.0, "ease": "ease_out_expo"}]}` (same for scale_y; attack 2 f = 0.03 s, decay about 8 f = 0.13 s).
5. For a physical card beside a list, kick it: `shear_x` +2 degrees at the swap frame decaying in 6-8 f (0.1-0.13 s); move the list's selection marker 6 f BEFORE the swap.
6. `add_sfx_tool {"recipe": "mouse_click", "at_seconds": 1.6, "gain_db": -18}`.

Fallback: A 3D card kick (a Y-axis rotation) is not available on a flat clip; the 2 % punch and a 2-degree shear carry the same hit.

## Timing & taste rules

- cinetic's timing (60 fps): Swap 1 f (0.02 s) on the cause frame; hover 6 f (0.10 s) before the press; recount 36-46 f (0.77 s) on ease_out_expo with 14 f (0.23 s) digit rolls; punch attack 2 f (0.03 s), tau 5; kick peaks on the swap frame and settles in 6-8 f (0.13 s); at most one swap per 30 f (0.50 s), 54 f (0.90 s) apart in a repeating sequence.
- Swap in 1 f on the cause frame; hover state 6 f (0.1 s) before the press.
- Recount 36-46 f (0.6-0.77 s) on ease_out_expo, digits roll 14 f (0.23 s); start the number 5-10 % below its new value.
- Punch 2 % with attack 2 f (0.03 s), tau about 5 f.
- At most one swap per 30 f (0.5 s); in a repeating sequence 54 f (0.9 s) apart.

## Sound for it

A mouse_click at -18 dB on the cause frame and a soft pop at -24 dB on the swap; nothing on the number roll.

## Common mistakes

- The change is a process the viewer should watch, so a swap hides the point.
- Two numbers sitting half-and-half in place at once.
- Swaps faster than one per 30 f (0.5 s): the clicks read as a macro.
- Avoid when: The change is a process the viewer should watch; two numbers would sit half-and-half in place; swaps faster than one per 30 f (the clicks read as a macro).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-hard-swap-on-cause`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
