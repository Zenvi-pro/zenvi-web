---
id: cin-ps-single-camera-journey
kind: technique
summary: "When one app is the whole story: every state sits on one surface and the film is one camera path between poses."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, screen_zoom_follow_tool, set_keyframes_tool, apply_fx_tool]
pace: calm
mood: [premium, calm, spatial]
aspect: ["16:9", "1:1"]
pairs_with: [shot-station-flythrough, cin-ps-locked-camera-holds, shot-cursor-flyover]
avoid_with: [cin-ps-oner-morph-chain, kcut-hit-fx]
needs: [perspective-plane-showcase]
drawn: cinetic
---

# One camera journey across one surface

cinetic `ps-single-camera-journey` · Pacing and structure · signature · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Every product state lives on one large surface and the film is a single camera path between poses; scene changes are pushes, pulls, orbits, whips and the interface's own window actions.

Use when: Walkthroughs of a single app, features where spatial orientation matters, and calm, premium product films.

## Build it in Zenvi

1. Lay every UI state on one big capture (a canvas 3-4x the frame); `add_clip_to_timeline_tool {"file_id": "<surface>", "position_seconds": 0, "duration_seconds": 20, "track": 1}`.
2. 12-17 poses with `screen_zoom_follow_tool {"clip_id": "<surface>", "zoom": 1.4, "ease": "ease_in_out_sine", "min_hold": 2.0, "stops": [[0.2, 0.3], [0.7, 0.4], [0.5, 0.8]]}` or, by hand, `set_keyframes_tool` on `scale_x`, `location_x`, `location_y` between poses over 56-108 f (0.93-1.8 s), `ease_in_out_sine`; one or two whips with `ease_in_out_expo`. At each pose the camera holds dead still while the UI acts.
3. Scene changes use the product's own behaviour, not cuts: a window minimizing to a corner (20-22 f, 0.33-0.37 s, `ease_in_cubic`), a bottom sheet rising (52 f, 0.87 s, `ease_out_expo`), a popover scaling from the cursor point (8-12 f, 0.13-0.2 s), a modal (26 f, 0.43 s) as `set_keyframes_tool` scale/alpha on separate clips. Chain them as exit, 4 f (0.07 s) gap, entrance.
4. Camera roll at most 11 deg on orbits; moves over 12 px/f get `apply_fx_tool {"clip_id": "<surface>", "effects": [{"effect": "directional_blur", "amount": 0.4, "start": 4.0, "end": 4.3}]}`.

Fallback: Real 3D orbits over a tilted surface are not available; use 2D scale/pan and a small rotation.

## Timing & taste rules

- cinetic's timing (60 fps): 0 cuts; about 3 moves per 10 s; moves 42-108 f (1.80 s) ease_in_out_sine; holds 18-252 f (4.20 s) (median setup about 170 f (2.83 s)); window actions 8-52 f (0.87 s).
- 0 cuts; about 3 moves per 10 s; moves 42-108 f (0.7-1.8 s) on ease_in_out_sine; holds 18-252 f (0.3-4.2 s), setup median about 170 f (2.8 s).
- Window actions 8-52 f (0.13-0.87 s).
- Roll at or under 11 deg on orbits.
- Motion blur on any move over 12 px/f.

## Sound for it

Cursor clicks get ui_tap or mouse_click at -18 dB; camera moves use a soft swish_airy at most; no hits.

## Common mistakes

- Multi-app or abstract stories: the surface metaphor breaks.
- Films under 10 s: not enough room for 12 poses.
- Cutting between poses instead of moving the camera.
- Avoid when: Multi-app or abstract stories, and films under 10 s.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-single-camera-journey`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
