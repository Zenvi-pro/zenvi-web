---
id: cin-ty-line-rebreak-glide
kind: technique
summary: "When a line must free half the frame: a one-line statement re-breaks into two lines, every word gliding to its new slot."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [fluid, organised]
aspect: ["16:9", "1:1"]
pairs_with: [cin-ty-recentre-line-build, shot-title-demote-to-label]
avoid_with: [cin-ty-staggered-word-roll]
needs: []
drawn: cinetic
---

# Animated line re-break

cinetic `ty-line-rebreak-glide` · Typography in motion · workhorse · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A centred one-line statement re-breaks into a two-line stack, or back, with every word gliding from its old slot to its new one, so the layout changes without a cut or a jump.

Use when: An inserted icon or a longer word makes a centred line too wide. A headline must stack to free half the frame for a product shot. Returning a stacked headline to a single line for the payoff.

## Build it in Zenvi

1. One title per word on tracks 3-7, laid out as one centred line (layout A): `add_title_tool {"text": "Ship", "template": "Standard_1", "position_seconds": 1.0, "duration_seconds": 4.0, "track": "3"}`, then the other words.
2. Word i glides from slot A to slot B with `set_keyframes_tool {"timeline_clip_id": "<w_i>", "property": "location_x", "ease": "ease_in_out_sine", "points": [{"seconds": <s + 0.033 i>, "value": <xA_i>}, {"seconds": <s + 0.033 i + D_i>, "value": <xB_i>}]}`, with D_i = 0.15 x travel clamped to 0.5-0.8 s (30-48 f), stagger 2 f (0.033 s) in the new reading order.
3. y leads by 4 f (0.07 s) on its own curve: `location_y` from yA_i to yB_i, `ease_out_expo`, starting 0.067 s earlier, so words that change rows drop first and slide second.
4. If the layout also shrinks, add `scale_x/y` 1.0 to <s_B/s_A> over the same window.
5. If an inserted icon causes the re-break, start the glide 6 f (0.1 s) after the icon lands. `add_sfx_tool {"recipe": "swish_airy", "at_seconds": <s>, "gain_db": -20}`.

## Timing & taste rules

- cinetic's timing (60 fps): Per word, D = 0.15 x travel, clamped to 30-48 f (0.80 s), on ease_out_cubic (peak about 20 px/f, near 30% of the move). y leads x by 4 f (0.07 s) on ease_out_cubic through arrive. Stagger 2 f (0.03 s) in the reading order of the new layout. Travel at most 320 px. Starts 6 f (0.10 s) after a causing insert. Settled drift 0.3 px/f.
- Per word D = 0.15 x travel, clamped 30-48 f (0.5-0.8 s), ease_in_out_sine; travel at most 320 px (0.17 of width).
- y leads x by 4 f (0.07 s) on ease_out_expo; stagger 2 f (0.033 s) in reading order of the new layout.
- Settled drift 0.3 px/f; start 6 f (0.1 s) after any causing insert.
- Never more than one re-break per statement; keep the hero word as the still anchor.

## Sound for it

One soft airy swish at the start of the glide, -20 dB, or none.

## Common mistakes

- Lines over about 7 words.
- Re-breaks that carry the hero word far from where it was being read.
- Vertical formats where a stack is already the default layout.
- Avoid when: Lines over about 7 words. Re-breaks that carry the hero word far from where it was being read (keep it as the still anchor). More than one re-break per statement. Vertical formats, where a stack is already the default layout.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-line-rebreak-glide`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
