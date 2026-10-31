---
id: cin-tr-select-retype-swap
kind: technique
summary: "When text is the medium: a headline is selected like in an editor, then a caret types the next line in its place."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [authored, writerly, wry]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-typewriter, prompt-bar-typing-hero, shot-type-to-pill]
avoid_with: [cin-tr-conveyor-line-swap, kinetic-word-pop]
needs: [text-selection-highlight]
drawn: cinetic
---

# Select and retype swap

cinetic `tr-select-retype-swap` · Transition · accent · energy calm · formats launch, feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A finished headline is selected like text in an editor, the highlight holds for a beat, and on one frame the selection is replaced by a caret that types the next line in the same place.

Use when: Products where text is the medium (editors, prompts, writing and AI tools); correcting a claim, where the assumption is selected and overwritten by the answer; two or three headline swaps that should feel authored.

## Build it in Zenvi

1. Line A on a paper stage, left-aligned: `add_title_tool {"text": "Writing is hard.", "position_seconds": 0, "duration_seconds": 2.0, "font_scale": 1.6, "text_color": "#161616", "background_color": "#f3efe6", "track": 1}`.
2. Selection highlight: a solid block glyph title, `add_title_tool {"text": "\u2588", "text_color": "#161616", "position_seconds": 0.8, "duration_seconds": 0.6, "track": 3}` scaled to the line (1.15 em tall from the ascender) with `scale_x` stepping word by word, last word to first, constant interpolation, every 2-3 f (0.03-0.05 s); a select-all covers the line in 1 f. The glyphs under it flip to paper colour via an overlay copy of the line in the paper colour clipped by the same width (`add_shape_mask_tool` rectangle).
3. Hold the selection 10-12 f (0.17-0.2 s), then on one frame remove A and the highlight (end both clips) and start the caret: `add_kinetic_title_tool {"text": "Writing is easy.", "position_seconds": 1.4, "duration_seconds": 2.2, "style": "documentary", "animation": "typewriter", "ink": "#161616"}` typing at 2 f per character (a 20-character line in 40 f / 0.67 s).
4. One tick on that frame: `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 1.4, "gain_db": -14}` and `{"recipe": "typing_burst", "at_seconds": 1.43, "gain_db": -20}`.
5. If B's last word is the beat that lands, give it the accent and relax it to ink over 12 f (0.2 s).

Fallback: Without a selection tool, the block-glyph-and-clone trick is clumsy; the nearest is a hard cut from A to a typewritten B with an inverted-colour pill glyph on a few frames.

## Timing & taste rules

- cinetic's timing (60 fps): Selection 2-3 f (0.05 s) per word (or a 1 f (0.02 s) select-all), hold 10-12 f (0.20 s), replace on 1 f (0.02 s). Line B types at 2 f (0.03 s) per character on ease_out_cubic (a 20-character line in 40 f (0.67 s)), and the caret blinks 30 f (0.50 s) on, 30 f (0.50 s) off once idle. About 60-75 f (1.25 s) in all for a five-word, 20-character pair.
- Selection 2-3 f (0.03-0.05 s) per word, or a 1 f select-all; hold 10-12 f (0.17-0.2 s); replace on 1 f.
- Line B types at 2 f per character (a 20-character line in 40 f / 0.67 s), caret blinking 30 f on / 30 f off when idle.
- About 60-75 f (1.0-1.25 s) in all for a five-word, 20-character pair.
- Same font, size and baseline for both lines; highlight 1.15 em tall.
- Two or three swaps at most in a row.

## Sound for it

One key tick on the replace frame, then soft typing ticks (-20 dB, no more than one per word).

## Common mistakes

- A product unrelated to text, lines past ~40 characters, or more than three swaps in a row (avoid_when).
- Different baselines for the two lines: the swap then shows.
- Fading A out instead of replacing it on one frame.
- Avoid when: The product has nothing to do with text, lines run past about 40 characters (the typing outlasts the read), or the swap repeats more than three times in a row and turns into a typing demo.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-select-retype-swap`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
