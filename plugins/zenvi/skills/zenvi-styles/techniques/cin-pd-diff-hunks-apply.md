---
id: cin-pd-diff-hunks-apply
kind: technique
summary: "When an assistant edits code or text, outgoing lines strike through and fold away, new ones open in place, hunk by hunk."
categories: [cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, screen_zoom_follow_tool, add_type_block_tool, add_motion_block_tool, add_sfx_tool, set_keyframes_tool]
pace: calm
mood: [precise, trustworthy, dev tool]
aspect: ["16:9", "1:1"]
pairs_with: [cin-pd-terminal-burst-output, cin-pd-ghost-suggestion-accept, cin-pd-agent-status-then-answer]
avoid_with: [kcut-hit-fx, cin-ui-clutter-pileup-strip]
needs: [diff-hunk-view]
drawn: cinetic
---

# Change applied as a visible diff

cinetic `pd-diff-hunks-apply` · Product demo · workhorse · energy calm · formats feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A proposed edit lands in a code or document view as a diff: outgoing lines strike through and fold away, incoming lines open in place with a marker in the gutter, and the view steps hunk by hunk before the change is accepted.

Use when: AI coding or writing assistants and review, versioning or migration tools, when the claim is 'it changes exactly the right lines and shows you which'.

## Build it in Zenvi

1. Best: a real recording of the product's diff view: `add_clip_to_timeline_tool {"file_id": "<diff_recording>", "position_seconds": 0.0, "duration_seconds": 8.0, "track": "1"}`; then frame the hunks with `screen_zoom_follow_tool {"clip_id": "<clip>", "zoom": 1.5, "min_hold": 1.2}`.
2. Built version: lines as separate clips beside a gutter of line numbers. An outgoing line gets a strike drawn left to right over 8 f (0.13 s): `add_type_block_tool {"block": "write_on", "paths": ["M0 0 L1 0"], "stroke_width": 2, "ink": "#8a8a8a", "x": <x>, "y": <y>, "position_seconds": 1.0, "duration_seconds": 0.4, "draw_seconds": 0.13}` while its text dims; 6 f (0.1 s) later it folds: `scale_y` to 0 over 12 f (0.2 s) with alpha gone in 8 f (0.13 s).
3. On the same frame the incoming slot opens from 0 to line height over 12 f (0.2 s) (lines below shifted with `location_y` keyframes), a 3 px accent bar appears in the gutter, the new text appears whole once the slot is 70 % open, and a 10 % accent row tint fades over 36 f (0.6 s) while the bar stays. Line numbers below change instantly, never tweened.
4. Step to the next hunk 60-90 f (1.0-1.5 s) later with a camera move of 48 f (0.8 s) `ease_in_out_sine` (`scale`/`location` keyframes), each hop under about 300 px (peak 19 px/f); farther than that, hard-cut on the same axis.
5. Accept: the cursor presses the button (`add_motion_block_tool {"block": "cursor_path", ...}`), every gutter bar fades over 12 f (0.2 s), and the clean file holds 36-48 f (0.6-0.8 s) under a 2 % breath.
6. `add_sfx_tool {"recipe": "paper", "at_seconds": 1.0, "gain_db": -26}` per hunk and `ui_tap` on Accept.

Fallback: There is no diff block; a real recording of the product's diff, zoomed with screen_zoom_follow_tool, is the honest version.

## Timing & taste rules

- cinetic's timing (60 fps): Strike 8 f (0.13 s) on ease_in_out_cubic; fold 12 f (0.20 s) on ease_in_out_cubic starting 6 f (0.10 s) later; slot open 12 f (0.20 s) on ease_in_out_cubic with the text in at 70%; tint relax 36 f (0.60 s); hunks 60-90 f (1.50 s) apart, camera hop 48 f (0.80 s) on ease_out_cubic (≤ 300 px); accept fade 12 f (0.20 s); final hold 36-48 f (0.80 s) under a 2% breath; at most three hunks.
- Strike 8 f (0.13 s); fold 12 f (0.2 s) starting 6 f (0.1 s) later; slot open 12 f (0.2 s) with text in at 70 %; tint relax 36 f (0.6 s).
- Hunks 60-90 f (1.0-1.5 s) apart, camera hop 48 f (0.8 s), at most about 300 px.
- At most three hunks; accept fade 12 f (0.2 s); final hold 36-48 f (0.6-0.8 s).
- Removals never get a second colour; only the accent marks additions.

## Sound for it

A faint paper tick at -26 dB per hunk and one ui_tap at -22 dB on Accept; strikes and folds are silent.

## Common mistakes

- Code unreadable at frame size: macro in first.
- More than three hunks: show a summary instead.
- Giving removals their own colour, which turns the diff into a rainbow.
- Avoid when: The code is unreadable at frame size (macro in first), or the change needs more than three hunks (show a summary instead); never give removals a second colour.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-diff-hunks-apply`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
