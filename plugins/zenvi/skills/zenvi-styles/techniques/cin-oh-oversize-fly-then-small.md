---
id: cin-oh-oversize-fly-then-small
kind: technique
summary: "When a thesis word deserves a preview: a huge translucent line brakes through, fades, then restarts small and readable."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [dark, energetic, editorial]
aspect: ["16:9", "9:16"]
pairs_with: [kinetic-emphasis-scale, shot-blur-slide, kinetic-mask-reveal]
avoid_with: [cin-oh-live-grid-cold-open, cin-oh-cropped-word-pull-back]
needs: []
drawn: cinetic
---

# Oversize line flies through, restarts small

cinetic `oh-oversize-fly-then-small` · Opening hook · signature · energy high · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A huge fragment of the headline, about a quarter of frame height, brakes in from the right with its letters fading on as it slows, then dissolves; three frames later the same line restarts small and centred so it can be read.

Use when: The headline has a thesis word worth previewing big, in a dark, energetic launch.

## Build it in Zenvi

1. Big line on a dark ground: `add_title_tool {"text": "Make it move", "position_seconds": 0, "duration_seconds": 0.6, "text_color": "#ffffffa6", "font_scale": 2.5, "screen_position": "center", "track": 3}`, sized ~25 % of frame height.
2. It is already braking at f0: `set_keyframes_tool {"timeline_clip_id": "<big>", "property": "location_x", "mode": "replace", "points": [{"seconds": 0, "value": 0.31}, {"seconds": 0.6, "value": 0.0, "ease": "ease_out_expo"}]}` (about 601 px at 1080p, 35 px/f at the start, 17 px/f by f6) and `alpha` `[{"seconds": 0, "value": 0.9}, {"seconds": 0.48, "value": 0.9}, {"seconds": 0.6, "value": 0, "ease": "ease_in_out_sine"}]` (fades over its last 7 f while still sliding).
3. Letters resolve as it slows: set the title with `animation: "letters"` through `add_kinetic_title_tool {"text": "Make it move", "position_seconds": 0, "duration_seconds": 0.6, "style": "documentary", "animation": "letters", "stagger_seconds": 0.025}` instead of step 1 when you want the per-letter fade (1.5 f stagger).
4. Small line starts the next frame, no gap: `add_kinetic_title_tool {"text": "Make it move", "position_seconds": 0.6, "duration_seconds": 2.4, "style": "documentary", "animation": "rise", "stagger_seconds": 0.02, "y": 0.5}`; add `location_x` `[{"seconds": 0.6, "value": 0.04}, {"seconds": 1.3, "value": 0, "ease": "ease_out_expo"}]` (an 84 px drift that lands centred, never over 12 px/f).
5. Keep the opening type translucent, the end card solid white.

Fallback: Per-letter opacity tied to speed is approximated with the letters animation; if it fades on too early, lower the stagger and let the alpha ramp do the work.

## Timing & taste rules

- cinetic's timing (60 fps): Big line visible from f0 (0.00 s) (its clock t = f + 6) to f35 (0.58 s): slide 39 f (0.65 s), about 35 px/f at t = 6 and 17 px/f at t = 12; letters 6 f (0.10 s) each, 1.5 f (0.03 s) stagger; fade over the last 7 f (0.12 s). No gap; small line from f36 (0.60 s), 13 characters in 17 f (0.28 s), drift settled in about 40 f (0.67 s).
- Start the big line already mid-move at f0 (its clock begins 6 f / 0.1 s early); 39-f (0.65 s) slide, ~35 px/f at the start, ~17 px/f by f12.
- Big line: ~270 px at 1080p, weight 500, 65 % white; letters fade on 6 f (0.1 s) each with a 1.5 f (0.025 s) stagger; layer fades over the last 7 f (0.12 s).
- No empty frames between the layers: a dissolve into nothing reads as the film restarting.
- Small line from f36 (0.6 s): 13 characters in 17 f (0.28 s), drift settled in ~40 f (0.67 s).
- Never let the big line sit still and cropped on both edges: it must travel every frame it shows.

## Sound for it

Optional single soft `whoosh_short` at -18 dB on f0; nothing on the restart.

## Common mistakes

- Light stages where 65 % white loses contrast, or headlines past ~5 words (avoid_when).
- A gap between the big and small layers: the viewer reads a false start.
- Cropped, static big text: it reads as a mistake, not a preview.
- Avoid when: Light stages where 65% white loses contrast, or headlines longer than about 5 words whose big fragment will not read. Also avoid it when the big fragment would sit still and cropped at both edges at any point: viewers read an oversized, cropped line that vanishes and then restarts small as a false start, not a preview. It has to travel every frame it is on screen.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-oversize-fly-then-small`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
