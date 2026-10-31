---
id: cin-ui-live-reflow
kind: technique
summary: "When a UI should visibly adapt, a card or window changes size and everything inside it reflows to the new width."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_motion_block_tool]
pace: medium
mood: [adaptive, precise, product]
aspect: ["16:9", "1:1"]
pairs_with: [cin-pd-headline-becomes-input, cin-ui-push-aside-reflow, shot-type-and-filter]
avoid_with: [cin-ui-container-morph, shot-glitch-tear-cut]
needs: [live-layout-reflow]
drawn: cinetic
---

# Container resizes, content reflows

cinetic `ui-live-reflow` · UI choreography · workhorse · energy medium · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A card or window changes size because its content or the user changes it, growing as typed text wraps or narrowing as an edge is dragged, while everything inside reflows to the new width.

Use when: Typing into an input, responsive layouts, resizable panels: any moment where the point is that the UI adapts.

## Build it in Zenvi

1. Best path: record the real UI being resized or typed into and place it: `add_clip_to_timeline_tool {"file_id": "<recording>", "position_seconds": 0.0, "duration_seconds": 3.0, "track": "1"}`; the reflow is then real.
2. Content-driven (typing widens the card): the card grows from 67 % to 77 % of frame width over 24 f (0.4 s): `set_keyframes_tool {"timeline_clip_id": "<card>", "property": "scale_x", "points": [{"seconds": 1.0, "value": 1.0}, {"seconds": 1.4, "value": 1.15, "ease": "ease_out_expo"}]}` (77 / 67 = 1.15), centred so both edges move; keep the text a separate clip so it is not stretched.
3. Typing and wrapping on a card you build: `add_motion_block_tool {"block": "prompt_bar", "params": {"prompt": "<long prompt>"}, "position_seconds": 0.0, "duration_seconds": 5.0}`.
4. User-driven drag: the right edge moves in 300-400 px over 40 f (0.67 s) with `ease_in_out_sine` and stops dead (no settle); the left edge follows at 15 % of its speed so the window re-centres.
5. At a breakpoint, replace the crossfade of two layouts with two clips whose elements move to their new slots over 16-24 f (0.27-0.4 s) `ease_in_out_sine`.

Fallback: A true width-driven reflow needs a real recording of the UI; without one, use two screenshots of the two sizes and move the blocks between slots with location keyframes over 0.27-0.4 s, never a crossfade.

## Timing & taste rules

- cinetic's timing (60 fps): Widen 67% to 77% FW over 24 f (0.40 s) (ease_out_cubic); +1 line per wrap over 12 f (0.20 s) (ease_out_expo). Drag 300-400 px over 40 f (0.67 s) (ease_in_cubic), ends near 40 px/f, hard stop; breakpoint FLIP 16-24 f (0.40 s) (ease_in_out_cubic); then a 0.3 px/f push-out.
- Card widens 67 % to 77 % of frame width over 24 f (0.4 s) on ease_out_expo (about 18 px/f per edge); each new wrapped line adds one line height over 12 f (0.2 s).
- Drag: 300-400 px over 40 f (0.67 s), hard stop with no settle, the cursor trailing the edge by 1 f.
- Layout change is a move over 16-24 f (0.27-0.4 s), fastest block under 70 px/f, then a 0.3 px/f push-out.
- Typed text appears on whole frames, not as a blur.

## Sound for it

None for the reflow; if the user drags, one soft mouse_click at -24 dB on the grab frame.

## Common mistakes

- The size change is a change of role (a button becoming a panel): use a container morph.
- Text that must be read while the box resizes: hold the copy still for the move.
- Crossfading two layouts: it reads as a cut, not as a layout that adapts.
- Avoid when: The size change is a change of role, such as a button becoming a panel (use a container morph), or text must be read during the resize.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-live-reflow`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
