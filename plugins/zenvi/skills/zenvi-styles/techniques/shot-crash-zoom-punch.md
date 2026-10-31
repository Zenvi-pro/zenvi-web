---
id: shot-crash-zoom-punch
kind: technique
summary: "When the eye must land on one target in a single beat: a 6-frame crash zoom from the wide view, a bounce or a hard stop."
categories: [saas-app-launch, product-launch-film, tech-review, gaming-montage, flash-cut-match-cut-edit]
tools: [apply_fx_tool, set_keyframes_tool, add_sfx_tool, add_clip_to_timeline_tool]
pace: fast
mood: [punchy, assertive]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-hit-fx, shot-scan-annotate, shot-slam-entrance, kinetic-keyword-slam]
avoid_with: [shot-pullback-isolation, shot-multiplane-slider, cinematic-push-in]
needs: []
---

# Crash zoom punch

## What it is
A slow push says "look". A crash zoom says "THIS": one beat from the full view to a close-up of the target, with no choice
about where to look. Two landings: a bounce (elastic, "look at this") or a hard stop with a short shake (weight, "that's it").
Pick by emphasis level; never both in one move.

## Build it in Zenvi
Target centre `(tx, ty)` as fractions of the frame; zoom `Z` 2.4-2.8. `location_x/y` are fractions of the frame and negative moves
the picture left/up, so `location = -(t - 0.5) * Z`. Bake the blur first (it renders into the clip), then keyframe:
```json
apply_fx_tool {"clip_id":"<id>","effects":[{"effect":"radial_blur","amount":0.95,"params":{"center_x":0.5,"center_y":0.72},"start":1.25,"end":1.45}]}
set_keyframes_tool {"timeline_clip_id":"<id>","property":"scale_x","mode":"replace","points":[
  {"seconds":0,"value":1.0},{"seconds":1.0,"value":1.03},                         // 2-3 % creep in the wide hold
  {"seconds":1.2,"value":0.97,"ease":"ease_out"},                                  // 6-8 f anticipation pull-back
  {"seconds":1.4,"value":2.5,"ease":"ease_in_cubic"},{"seconds":4.5,"value":2.55,"ease":"ease_out"}]}
```
(same points for `scale_y`; the `//` notes are comments, leave them out of the JSON). Then `location_y` (and `location_x`) from 0 to
`-(ty-0.5)*Z` over the same 6 frames, `ease_in_cubic`, so the target converges to the centre as it grows.
- Bounce landing: add `{"seconds":1.567,"value":2.4}` (a 3-6 % pull-back of the zoom) then settle.
- Hard-stop landing: no bounce; shake with 5 `linear` keyframes on `location_x/y`, amplitude 0.045 of the frame decaying with tau ~1.8 f, quiet by 6 f.
Sound: `add_sfx_tool {"recipe":"whoosh_short","at_seconds":1.35,"gain_db":-14}`, `{"recipe":"impact_slam","at_seconds":1.4,"gain_db":-5,"intensity":0.9}` and a `sub_drop` at -10 dB.

## Timing & taste rules
- Rush 6 f (4-8 f); >10 f reads as a normal push. Target fills 60-75 % of the frame at the end. Hold >= 30 f wide before and >= 45 f on the close-up after.
- Blur only on the rush; the shake frames stay sharp. Wide window = 6-frame blur at amount 0.7-0.95.
- Zoom beyond ~2.8x needs a hi-res source (card: a hires texture for the target, not an upscaled screenshot).
- Bounce amplitude 3-6 % of zoom; more reads as a spring toy. Shake must be visible: 14 px at 1080p (~0.013 frame) is the floor; >20 px reads as a glitch.
- One crash zoom, two at most per film.

## Sound for it
Whoosh peaking on the last frame of the rush, impact on the first frame of the stop, same frame for the shake. A silent punch looks like a stutter.

## Common mistakes
- Mixing the bounce landing with a shake: looks like an error.
- Low-res target: the close-up is soft; shoot or import it large.
- FX baked after keyframes then scaled again: bake the blur first, keyframe the baked clip.

## Verified
2026-10-29, CLI on a generated 6-card dashboard clip (ffmpeg `drawbox`): scripts/shot-crash-zoom-punch.sh → shots/shot-crash-zoom-punch.mp4 (local only). Checked on the sheet: a wide hold with a slight pull-back, then the orange card fills the frame in six frames with a zoom-blurred rush frame, and holds slightly off-centre. Watch judge (absolute): **5.3/10**; main note: "The motion lacks authentic optical zoom blur and camera shake on impact to sell physical momentum."

Adapted from video-shotcraft card `shots/camera/crash-zoom-punch.md` (Apache-2.0; see ../NOTICE).
