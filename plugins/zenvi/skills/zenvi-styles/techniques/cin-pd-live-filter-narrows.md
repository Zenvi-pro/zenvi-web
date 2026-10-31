---
id: cin-pd-live-filter-narrows
kind: technique
summary: "When speed means type a few letters and it is there, a palette opens and the list narrows with every key."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_title_tool, add_effect_tool, update_effect_tool, add_sfx_tool, set_keyframes_tool]
pace: medium
mood: [instant, responsive, product]
aspect: ["16:9", "1:1"]
pairs_with: [shot-type-and-filter, prompt-bar-typing-hero, cin-ui-live-reflow]
avoid_with: [cin-ui-clutter-pileup-strip, cin-pd-drag-assets-skeleton-fill]
needs: [live-layout-reflow]
drawn: cinetic
---

# List narrows with each keystroke

cinetic `pd-live-filter-narrows` · Product demo · workhorse · energy medium · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A shortcut opens a command palette or search field, and as the query types the list answers every key: non-matching rows fold away, survivors slide up, matched letters ink in, and the highlight rides the top result until Enter.

Use when: Search, command menus, filters and pickers: any product whose speed claim is 'type a few letters and it is there', proving instant results without a spinner.

## Build it in Zenvi

1. Best: record the real palette and place it: `add_clip_to_timeline_tool {"file_id": "<palette_recording>", "position_seconds": 0.0, "duration_seconds": 5.0, "track": "2"}` over the app on track 1. The steps below frame it.
2. Shortcut: two key chips 4 f (0.07 s) apart pressing together (`add_title_tool {"text": "Cmd", "font": "mono"}` x2). On the press frame the palette scales 0.96 to 1 about its top centre with alpha over 10 f (0.17 s) on `ease_out_cubic`, while the app behind blurs to 8 px (`add_effect_tool {"timeline_clip_id": "<app>", "effect": "Blur"}` then `update_effect_tool` radius up over 12 f / 0.2 s) under a 20 % ink veil.
3. Rows built yourself: one clip per row. As each key lands (30-40 characters per second, 4-7 keys narrowing 8-10 rows to 1-3), non-matching rows fold: `scale_y` to 0 over 10 f (0.17 s) with alpha gone in 6 f (0.1 s); survivors move to their new slots over max(12 f, 0.14 x distance) = 0.2 s or more, `ease_in_out_sine`, so no label passes 20 px/f.
4. Matched letters switch to ink and the rest drops to grey on the key frame, colour only, never weight. One shared highlight clip sits behind the top result and moves to its new rect over 8 f (0.13 s).
5. Enter: the chosen row takes a 12 % accent tint for 6 f (0.1 s), the palette closes (scale 1 to 0.98, alpha out over 8 f / 0.13 s) and the result clip starts on the press frame. Hold the final list 24-36 f (0.4-0.6 s) under a 2 % breath before Enter.
6. `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": <key_k>, "gain_db": -22}` per key, `mouse_click` on Enter.

Fallback: Without per-row control, use the real recording and a push-in with screen_zoom_follow_tool so the narrowing list is large enough to read.

## Timing & taste rules

- cinetic's timing (60 fps): Chips 4 f (0.07 s) apart, press 4 f (0.07 s) down + 8 f (0.13 s) recoil; palette 10 f (0.17 s) on ease_out_cubic, backdrop rack and veil 12 f (0.20 s); query 30-40 cps; row fold 10 f (0.17 s) on ease_in_out_cubic (opacity 6 f (0.10 s)); survivor FLIP max(12, 0.14 × px) f on ease_in_out_cubic; highlight 8 f (0.13 s) on ease_in_out_cubic; 4-7 keys narrow 8-10 rows to 1-3; final list held 24-36 f (0.60 s) under a 2% breath before Enter; close 8 f (0.13 s).
- Chips 4 f (0.07 s) apart; palette 10 f (0.17 s); backdrop blur and veil 12 f (0.2 s); query 30-40 characters per second.
- Row fold 10 f (0.17 s), opacity out in 6 f (0.1 s); survivor move at least 12 f (0.2 s); highlight 8 f (0.13 s).
- Do not move more than about ten rows at once; a query longer than about 12 characters becomes a typing beat.
- Close 8 f (0.13 s).

## Sound for it

A soft keyboard_key tick at -22 dB per key, a mouse_click at -18 dB on Enter; none on the folds.

## Common mistakes

- Rows illegible at frame size: punch in first.
- A long query past about 12 characters.
- Animating more than about ten rows at once: it turns to noise.
- Avoid when: The rows are illegible at frame size (punch in first), or the query is long (past about 12 characters it becomes a typing beat); do not FLIP more than about ten rows at once.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-live-filter-narrows`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
