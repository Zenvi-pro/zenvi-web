---
id: cin-lc-headline-over-ghost-ui
kind: technique
summary: "When a demo follows a claim: the headline inks in over a faint ghost of the UI, then the UI resolves as it leaves."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_title_tool, add_effect_tool, update_effect_tool]
pace: calm
mood: [quiet, editorial, premium]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-lc-negative-space-caption, shot-blur-slide, shot-crane-rise-reveal]
avoid_with: [cin-lc-bento-cell-takeover]
needs: []
drawn: cinetic
---

# Headline over a ghost of the UI

cinetic `lc-headline-over-ghost-ui` · Layout and composition · accent · energy calm · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A headline inks in from light grey to near-black while a faint copy of the product interface sits behind it, then the UI resolves to full strength as the headline leaves.

Use when: Setting up a demo during a statement, so the move into the product needs no transition; a claim that names the product area about to be shown.

## Build it in Zenvi

1. UI capture on the video track, dim: `add_clip_to_timeline_tool {"file_id": "<ui_capture>", "position_seconds": 0, "duration_seconds": 5, "track": 1}` then `set_keyframes_tool {"timeline_clip_id": "<ui>", "property": "alpha", "mode": "replace", "points": [{"seconds": 0, "value": 0.15}, {"seconds": 2.2, "value": 0.15}, {"seconds": 3.2, "value": 1.0, "ease": "ease_in_out_sine"}]}`. Put a black or paper title card on the track below so the dimmed UI sits on the stage colour.
2. Same clip scale: `set_keyframes_tool {"timeline_clip_id": "<ui>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 2.2, "value": 1.03}, {"seconds": 3.2, "value": 1.0, "ease": "ease_in_out_sine"}]}` and `scale_y` the same.
3. Headline inking from grey to near-black as two stacked titles: `add_title_tool {"template": "Standard_1", "text": "<claim>", "text_color": "#9a9a9a", "position_seconds": 0.2, "duration_seconds": 2.4, "track": 3}` and the same text in `"#161616"` on track 4 with `"fade_in_seconds": 0.67, "fade_out_seconds": 0.27`. The dark copy fading in over 40 f (0.67 s) is the ink.
4. If the capture is busy, defocus the ghost: `add_effect_tool {"effect": "Blur", "timeline_clip_id": "<ui>"}`, set radius about 10, then `update_effect_tool` with a keyframe to 0 across 2.2-3.2 s.

## Timing & taste rules

- cinetic's timing (60 fps): Ink resolve 40 f (0.67 s). Ghost UI at 10-20% opacity under the headline; it resolves to 100% over 60 f (1.00 s), starting when the headline's exit begins.
- Ghost UI at 10-20 % opacity under the headline; it reaches 100 % over 60 f (1.0 s) starting when the headline's exit begins.
- Ink resolve 40 f (0.67 s), ease_out_cubic; headline exit is a 16 f (0.27 s) fade.
- UI scale 1.03 to 1.00 on the same 60 f ease so the next shot is already composed.
- Defocus a busy ghost to blur 10 and rack it sharp during the resolve.

## Sound for it

None, or one very soft swish_airy at -20 dB as the UI resolves. The move is quiet.

## Common mistakes

- High-contrast UIs whose ghost muddies the type: dim harder or defocus.
- UI text at the same scale as the headline sitting right behind it.
- Letting the UI snap to full strength instead of resolving over 60 f.
- Avoid when: High-contrast UIs whose ghost would muddy the type, or UI text at the same scale as the headline sitting directly behind it.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-headline-over-ghost-ui`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
