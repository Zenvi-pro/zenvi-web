---
id: shot-pullback-isolation
kind: technique
summary: "When the last beat is one thing only: pull back from the hero card while its siblings dim to black, leaving it glowing."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, video-essay-explainer, map-data-explainer]
tools: [set_keyframes_tool, add_vignette_tool, add_clip_to_timeline_tool, apply_clip_preset_tool, speed_ramp_tool, add_sfx_tool]
pace: calm
mood: [lonely, emphatic, reflective]
aspect: ["16:9", "9:16"]
pairs_with: [kinetic-counter, kinetic-title-sequence, shot-cursor-flyover]
avoid_with: [shot-crash-zoom-punch, shot-overhead-tilt-drop, shot-station-flythrough]
needs: [perspective-plane-showcase]
---

# Pull-back isolation (and bullet-time freeze as the heavy cousin)

## What it is
Mood camera moves with small motion and large meaning. Pull-back isolation: start on a glowing hero card filling the frame;
the camera retreats, sibling cards switch off one by one by distance, the background sinks to black, one card floats in the dark.
A closing sentence or number lands there. (Second form, bullet-time: a chart growing mid-way is frozen with its sparks hanging, the
camera orbits ~52 degrees around the panel and back, time resumes and the chart finishes growing.)

## Build it in Zenvi
Pull-back (all native):
1. Layout: hero card plus siblings as separate stills on tracks above a dark base; or a real screenshot where the hero is a crop in focus.
2. Retreat: `set_keyframes_tool property=scale_x` and `scale_y` on every layer together: 2.2 at 0 s to 0.62 at 3.7 s, `ease_out_cubic`. Keep the hero at the origin (put the hero at screen centre so scaling pulls to it).
3. Lights out: on each sibling `set_keyframes_tool property=alpha` 1 to 0 over 16 f (`ease_out`), starting at frame 30 and then every 8 f ordered by distance from the hero (near to far). Add `Blur` (5 px) + `Brightness` -0.7 ramps with the same timing via `add_effect_tool` keyframed `properties`. Background fades by a dark card from 2.0 to 3.7 s.
4. Halo: two cool-white `Shadow` effects (`color`, `blur_radius` 60-100) on the hero, opacity 0 to 0.6 across 60-100 f; `add_vignette_tool {"amount":0.5}`.
5. End: hold >= 40 f completely still; a closing line via `add_kinetic_title_tool`.
Bullet-time: `speed_ramp_tool {"clip_id":"<chart clip>","preset":"hero","slow":0.02,"ramp_seconds":0.27,"hold_seconds":1.7,"audio":"mute"}` freezes the content clip while the camera layer (a second clip with `rotation`/scale keyframes) keeps moving; true orbit needs a perspective plane (`needs: perspective-plane-showcase`).

## Timing & taste rules
- 5-6 s (150-170 f). Pull-back: first 20 f the hero still fills the frame (open on the close-up, no extra hold).
- Lights out 16 f each, stagger 8 f, ordered by distance: near to far feels like the world collapsing outward; random order looks like a glitch.
- Glow fades in with the darkness (60-100 f) so "only this remains" has a visual witness.
- At most two tension moves per film, one use of each. Pull-back and an outro group-shot cancel each other.
- Bullet-time: freeze 52 f, ramp in/out 8 f; the content clock freezes completely while the camera moves; 50-55 degrees is the minimum for "went round the side"; >70 and the panel looks like paper. Do not stack with `speed_ramp_tool` freezes or impact frames in the same shot.

## Sound for it
Tail-off: `reverse_swell` into the start, a single `sub_drop` (-14 dB) as the last sibling goes dark, then silence or `room_tone` low.

## Common mistakes
- Blowing up a small screenshot for the 2.2x opening: soft text. Place the hero at native size and scale the others down instead.
- Dim siblings to 0 too early: no sense of a world to collapse.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/camera/tension-camera-moves.md` (Apache-2.0; see ../NOTICE).
