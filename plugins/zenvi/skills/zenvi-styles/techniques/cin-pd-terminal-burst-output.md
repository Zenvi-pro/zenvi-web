---
id: cin-pd-terminal-burst-output
kind: technique
summary: "When a CLI is the product, a command types at human speed and the terminal answers in fast bursts to one success."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [technical, fast, dev tool]
aspect: ["16:9", "1:1"]
pairs_with: [cin-pd-diff-hunks-apply, shot-brake-scroll, shot-glitch-cycle]
avoid_with: [cin-pd-chart-scrub-readout, kinetic-typewriter]
needs: [burst-printed-output-schedule]
drawn: cinetic
---

# Command runs, output prints in bursts

cinetic `pd-terminal-burst-output` · Product demo · workhorse · energy medium · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A command is typed at human speed and entered; the terminal answers machine-fast, printing whole lines in uneven bursts with a stepping spinner and a progress bar, and ends on a single success line.

Use when: Developer tools, CLIs, infrastructure and build products, where the contrast between a human-typed command and machine-fast output is the speed claim.

## Build it in Zenvi

1. Best: a real terminal recording: `add_clip_to_timeline_tool {"file_id": "<terminal_recording>", "position_seconds": 0.0, "duration_seconds": 5.0, "track": "1"}` with the command typed by hand at 30 characters per second, then the real output; trim dead time between bursts so lines arrive 40-80 in 120-180 f (2-3 s).
2. Built terminal: `add_motion_block_tool {"block": "code_card", "params": {"code": "<command>", "language": "shell", "filename": "zsh", "output": "<line 1>\n<line 2>\n...<success line>"}, "position_seconds": 0.0, "duration_seconds": 8.0}` (the run strip opens under the typed command with its result).
3. Keep a 2 % breath on the whole run: `set_keyframes_tool {"timeline_clip_id": "<terminal>", "property": "scale_x", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 5, "value": 1.02, "ease": "ease_in_out_sine"}]}` (same for scale_y).
4. Type the command with keys appearing whole (no fade), hold the caret 10 f (0.17 s), enter on a quiet tick. Output never types: whole lines appear on single frames in uneven bursts (3 lines on consecutive frames, a 14 f / 0.23 s gap, 5 lines 2 f / 0.03 s apart, a 22 f / 0.37 s gap). A spinner steps every 4 f (0.07 s) beside a progress bar that fills over 60 f (1.0 s).
5. It ends on one success line (check mark and key word in the accent) held 48-60 f (0.8-1.0 s), then a prompt with the caret blinking 30 f on / 30 f off (0.5 s each).
6. `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 0.0, "gain_db": -22}` per few keys, `typing_burst` for the command, a soft `ui_tap` on Enter.

Fallback: The code_card block prints its output as one strip, not in uneven bursts; for the burst rhythm use the real recording and cut the gaps with remove_gaps or trim_clips_tool.

## Timing & taste rules

- cinetic's timing (60 fps): Command at 30 cps, caret hold 10 f (0.17 s); bursts of 2-6 lines 1-2 f (0.03 s) apart with 10-24 f (0.40 s) gaps (40-80 lines in 120-180 f (3.00 s) reads machine-fast); line relax 24 f (0.40 s); burst scroll max(6, 0.14 × px) f on ease_in_out_cubic; spinner step 4 f (0.07 s); progress bar 60 f (1.00 s) on ease_in_out_sine; success line held 48-60 f (1.00 s) under the breath with the caret blinking 30/30.
- Command at 30 characters per second, keys appear whole; caret hold 10 f (0.17 s).
- Bursts of 2-6 lines 1-2 f (0.02-0.03 s) apart with 10-24 f (0.17-0.4 s) gaps; 40-80 lines in 120-180 f (2-3 s) reads machine-fast.
- Newest line white, older lines relax to grey over 24 f (0.4 s); text never passes 20 px/f while scrolling.
- Success line held 48-60 f (0.8-1.0 s).

## Sound for it

Soft keyboard ticks for the command, a quiet ui_tap on Enter at -24 dB, then silence under the output; the machine is quiet.

## Common mistakes

- The audience is not technical.
- Output that must be read line by line: show the result screen instead.
- Typing the output: it must appear in whole-line bursts.
- Avoid when: The audience is not technical, or the output itself must be read line by line (show the result screen instead); never type the output.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-terminal-burst-output`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
