---
id: cin-pd-ghost-suggestion-accept
kind: technique
summary: "When an assistant completes text inline, pale ghost text follows the caret, a key is pressed and the ghost inks in."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_title_tool, add_sfx_tool, set_keyframes_tool]
pace: calm
mood: [assistive, precise, product]
aspect: ["16:9", "1:1"]
pairs_with: [cin-pd-fast-prompt-true-scale, cin-mi-field-focus-caret, cin-pd-diff-hunks-apply]
avoid_with: [cin-pd-agent-status-then-answer, kinetic-word-pop]
needs: [left-to-right-colour-front]
drawn: cinetic
---

# Ghost suggestion accepted with a key

cinetic `pd-ghost-suggestion-accept` · Product demo · workhorse · energy calm · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

As someone types, the product proposes the rest of the line as pale ghost text after the caret; a small key chip appears, the key is pressed, and the ghost text inks in left to right as the caret jumps to its end.

Use when: An assistant that completes text, code, email or form fields inline: the moment the product does the work is one key away, and the cause (the key) and the effect (the ink) share a frame.

## Build it in Zenvi

1. The typed prefix at a human 30 characters per second: `add_motion_block_tool {"block": "code_card", "params": {"code": "<prefix>", "language": "ts", "filename": "<file>"}, "position_seconds": 0.0, "duration_seconds": 5.0}` (or `prompt_bar` for prose).
2. 12 f (0.2 s) after the last key the suggestion appears whole on one frame, in the same font and baseline, pale: `add_title_tool {"text": "<suggestion>", "text_color": "#9a9a9a", "position_seconds": 1.2, "duration_seconds": 3.5, "track": "<n>"}` placed to start exactly at the caret, so nothing typed reflows. Longer blocks stream at 2 characters per frame.
3. 12 px past its last glyph a key chip: `add_title_tool {"text": "Tab", "font": "mono", "background_color": "#ffffff", "position_seconds": 1.2, "duration_seconds": 1.5}` pops scale 0.8 to 1 with alpha over 6 f (0.1 s) on `ease_out_back`; keep the 30-40 f (0.5-0.67 s) wait alive with a 2 % breath on the shot.
4. Accept: the chip presses (`location_y` 2 px down, 4 f / 0.07 s, back 8 f / 0.13 s). On that frame the ghost turns to ink: a second title clip in the ink colour (accent first, relaxing to ink over 12 f / 0.2 s) replaces it; run the change as a left-to-right front over 10 f (0.17 s) per line, lines 3 f (0.05 s) apart. The old caret ends and a caret appears at the suggestion's end on the same frame.
5. The chip fades out over 8 f (0.13 s) from accept +4 f. Rejection: chip labelled Esc and the ghost fades out over 8 f.
6. `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 2.0, "gain_db": -16}` on the press.

Fallback: There is no per-character colour front; cross-fade the ghost clip to the ink clip over 10 f (0.17 s) per line, or record the real product and place it.

## Timing & taste rules

- cinetic's timing (60 fps): Prefix at 30 cps; ghost text 12 f (0.20 s) after the last key, whole in 1 f (0.02 s) (or 2 characters per frame); chip on ease_out_cubic with a 6 f (0.10 s) fade; wait 30-40 f (0.67 s) under a 2% breath; press 4 f (0.07 s) down, 8 f (0.13 s) recoil; recolour front 10 f (0.17 s) per line (lines 3 f (0.05 s) apart), accent relax 12 f (0.20 s); chip out over 8 f (0.13 s) from ACCEPT + 4; read hold after acceptance 36-48 f (0.80 s).
- Prefix at 30 characters per second; ghost 12 f (0.2 s) after the last key, whole in 1 f; chip 6 f (0.1 s) pop; wait 30-40 f (0.5-0.67 s) under a 2 % breath.
- Press 4 f (0.07 s) down, 8 f (0.13 s) recoil; recolour front 10 f (0.17 s) per line, lines 3 f (0.05 s) apart; accent relaxes to ink over 12 f (0.2 s).
- Chip out over 8 f (0.13 s) from accept + 4 f; read hold afterwards 36-48 f (0.6-0.8 s).
- Never more than two accepts in a row.

## Sound for it

A keyboard_key at -16 dB on the press frame; the ghost appearing is silent.

## Common mistakes

- The product generates whole answers, not inline completions: stream the answer instead.
- A suggestion past about two lines at readable size.
- Showing more than two accepts in a row.
- Avoid when: The product generates whole answers rather than inline completions (stream the answer instead), or the suggestion runs past about two lines at readable size; never show more than two accepts in a row.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-ghost-suggestion-accept`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
