---
id: cin-ui-genie-launch-from-icon
kind: technique
summary: "When an app opens from its icon, the icon flares into a widening funnel that fills the frame with the first screen."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, apply_motion_transition_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [playful, native, launching]
aspect: ["16:9", "9:16"]
pairs_with: [shot-ui-to-brand-morph, cin-pd-mark-docks-into-app, cin-pd-device-rise-on-cut]
avoid_with: [cin-ui-anchor-point-spawn, cin-ui-container-morph]
needs: [keyframed-polygon-mask]
drawn: cinetic
---

# Genie launch from an icon

cinetic `ui-genie-launch-from-icon` · UI choreography · accent · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A dock or home-screen icon flares open at its top into a curved funnel that keeps widening until it fills the frame, and the app's first screen is already sitting inside it.

Use when: Opening an app, a document or a tool from its icon in a dock, launcher or home screen, as a playful product-native scene change.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same `dock_magnify` click, but pass one flat colour for the icons (`"colors": ["<one flat colour>"]`), never a ramp.
2. The incoming screen is the real first screen on its flat stage colour, or one flat colour taken from the icon, under the same `zoom_through`.
3. Timings (44 f / 0.73 s, 4 f / 0.07 s after the press) are unchanged.

**Full look** (relies on gradient: only when the person's brand supplies that look):

1. Dock and click: `add_motion_block_tool {"block": "dock_magnify", "params": {"background": "<wallpaper>", "apps": ["<a>", "<b>", "<c>", "<d>"], "target": 2, "colors": ["<c1>", "<c2>", "<c3>", "<d4>"], "open": true}, "position_seconds": 0.0, "duration_seconds": 6.0}` (the pointer glides, the icons swell, the target is clicked and its icon zooms at the viewer).
2. The app's first screen is a clip sitting under the block, starting at the cover frame: `add_clip_to_timeline_tool {"file_id": "<first_screen>", "position_seconds": 5.2, "duration_seconds": 4.0, "track": "1"}`.
3. If the zoom does not fill the frame by itself, hide the join: `apply_motion_transition_tool {"preset": "zoom_through", "clip1_id": "<dock>", "clip2_id": "<screen>", "duration": 0.73, "direction": "up"}` (44 f = 0.73 s; the funnel starts 4 f / 0.07 s after the press).
4. Optional settle on the revealed screen: `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "scale_x", "points": [{"seconds": 5.2, "value": 1.04}, {"seconds": 5.93, "value": 1.0, "ease": "ease_out_cubic"}]}` (same for scale_y).
5. On the first fully covered frame the old scene is gone and the app's first UI event (a caret, a typed greeting) starts on that frame. `add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 5.2, "gain_db": -16}`.

Fallback: The curved funnel outline needs an animatable, non-convex mask Zenvi does not have; the dock zoom plus zoom_through gives the same hand-over from icon to screen without the pinched funnel.

## Timing & taste rules

- cinetic's timing (60 fps): Press, then funnel from +4 f (0.07 s): 44 f (0.73 s) in log space (about x1.06-1.08 per frame, linear progress). Centre drift over the same 44 f (0.73 s) (ease_in_out_sine). Waist and bottom edge open over the last 24 f (0.40 s) (ease_in_out_sine). Fastest edge ~70-75 px/f at the end. Optional content settle 1.04 to 1 over 44 f (0.73 s) (ease_out_cubic). Clip removed on full cover; the next UI event starts on that frame.
- Funnel starts 4 f (0.07 s) after the press and runs 44 f (0.73 s); growth is exponential so it leaves the icon slowly and speeds up.
- Fastest edge about 70-75 px/f on the last frames.
- Optional content settle 1.04 to 1 over 44 f (0.73 s) on ease_out_expo.
- Remove the old scene on the first full-cover frame and start the app's first event on that same frame.

## Sound for it

A whoosh_rise at -16 dB that peaks on the cover frame, then the app's own first sound (a key tick) on the frame after; the press gets a soft mouse_click.

## Common mistakes

- The product is never launched from an icon: the gesture will feel borrowed.
- Using the genie twice in one film: once is a gag, twice reads as a template.
- A gradient icon fill leaking into the funnel when the brand bans gradients.
- Avoid when: The product is never launched from an icon, or the film already has a genie (once is a gag, twice reads as a template).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-genie-launch-from-icon`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
