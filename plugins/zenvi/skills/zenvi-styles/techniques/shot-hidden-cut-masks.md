---
id: shot-hidden-cut-masks
kind: technique
summary: "When a cut should go unseen or feel ceremonial: hide it in a white flash, a passing foreground blocker or a collision."
categories: [flash-cut-match-cut-edit, saas-app-launch, product-launch-film, tech-review, movie-game-trailer]
tools: [apply_motion_transition_tool, add_shape_mask_tool, set_keyframes_tool, add_clip_to_timeline_tool, add_kinetic_title_tool, add_sfx_tool]
pace: fast
mood: [slick, magic-trick, punchy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-match-on-action, kcut-hit-fx, kinetic-keyword-slam]
avoid_with: [shot-glitch-tear-cut, shot-match-iris-window, shot-bottom-push-chapters, shot-ink-bleed-reveal]
needs: [occluder-plate-wipe, polygon-matte-transition]
---

# Hidden cut: flash, blocker, collision

## What it is
Misdirection: the hard cut happens in the 1-3 frames when the eye is pulled elsewhere. Three covers: a white flash (the
plain one), a soft out-of-focus foreground object sweeping the lens (invisible, one-take feel), two halves colliding with
an impact and a VS stamp (ceremonial, for two sides). Warm light-leak cover: see `cinematic-light-leak`.

## Build it in Zenvi
A, white flash (a push-in rides into it):
`apply_motion_transition_tool {"preset": "flash_white", "clip1_id": "<A>", "clip2_id": "<B>", "duration": 0.17}` (5 f each side of
the cut), with a `scale_x` / `scale_y` push 1.0 to 1.08 on A over its last second.
B, blocker (a soft dark plate crossing the lens): a plate clip (a dark card) on a track above:
`add_title_tool {"background_color": "#2a1810", "position_seconds": 1.9, "duration_seconds": 0.5, "track": "3"}`; `add_shape_mask_tool` rectangle,
width 0.9 with `feather: 0.12` (soft edge = defocus + blur), sweep `location_x` +1.2 to -1.2 over 14 f with `ease_in_out`; put the hard cut under the
frame where the plate covers 0 to 1 of the width. Slide the whole scene 40 px (`location_x` 0.02 to -0.02) across the cut and pull A left
28 px / settle B from the right over 14 f so it reads as one take. A true occluder cut-finder and plate with a lit edge is
`needs: occluder-plate-wipe`.
C, collision (two sides facing off): A and B each masked to a half (`add_shape_mask_tool` rectangle x 0.25 / 0.75, width 0.5), sliding
in from +-1.0 by `location_x` with `ease_in_cubic` over 10 f; on the impact frame `apply_motion_transition_tool {"preset": "shake",
...}` or a `flash_white`, plus a stamp `add_kinetic_title_tool {"text": "VS", "animation": "slam", "position_seconds": <impact>}`.
The 78 degree slanted seam is `needs: polygon-matte-transition`; a vertical seam is the fallback (reads like a split screen).

## Timing & taste rules
- Flash: cut on the white frame, 5 f in, 5 f out; white is a cover, never a decoration.
- Blocker: 14 f sweep, the cut when the solid core covers the frame (about f39 of 32-46); the core must really cover (2600 px of a
  3280 px plate at 1920); look at the cut frame, a visible sliver breaks the trick. Give an action before and a result after.
- Collision: halves arrive on ease-in (acceleration is the slam), impact: flash 3 f + shake 16 px x e^(-t/1.7) over 5 f + stamp with
  one visible overshoot, all on one frame; one frame apart and it falls apart. Only for two-sided content.
- One cover per join; two of them on the same seam are a mistake. Flash and warm leak in one film count as two.

## Sound for it
Flash: a `whoosh_short` (-16 dB), then nothing. Blocker: `whoosh_medium` and a soft `cloth` at the cover. Collision: `impact_slam` on the impact frame, a 16 px shake for 5 f.

## Common mistakes
- Blocker not covering at the cut frame.
- VS and a collision for non-comparison content.
- Plate dark but flat edge: the soft edge is the defocus.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/transition/transition-hidden-cut.md` (A, B) and `shots/transition/shot-transitions.md` (flash cut) (Apache-2.0; see ../NOTICE).
