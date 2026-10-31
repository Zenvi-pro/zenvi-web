---
id: faceless-performer-occlusion
kind: technique
summary: "For an anonymous-performer music video: a solid black oval rides each dancer's face so the choreography leads."
categories: [music-lyric-video]
tools: [add_title_tool, add_clip_to_timeline_tool, set_clip_properties_tool, add_shape_mask_tool, set_keyframes_tool, fade_clip_tool, master_audio_tool]
pace: medium
mood: [surreal, playful, mysterious]
aspect: ["16:9", "9:16"]
pairs_with: [one-hue-treatment-with-glow-silhouette, bar-phrase-and-lyric-locked-cutting, lyric-text-timed-to-vocals]
avoid_with: [diegetic-lyric-on-set-props]
needs: [tracked-face-mask]
---

# Faceless-performer occlusion

## What it is

A flat black oval sits over a dancer's face for a whole passage (the
reference holds it 27 s), following every head move, so the performer is
anonymous and the body and choreography carry the video. It only works if
the oval never slips: one visible frame of face breaks the idea.

## Build it in Zenvi

The oval is a full-frame black title masked to an ellipse; the mask moves
with the clip, so keyframing the title's location moves the oval. The head
positions must come from somewhere: there is no web/CLI face tracker
(the OpenCV Tracker effect is desktop-only and gives a box, not a layer).

```json
add_title_tool {"text": " ", "position_seconds": 0, "duration_seconds": 6, "background_color": "#5a2a63", "track": "1"}
add_clip_to_timeline_tool {"file_id": "<dancer on black>", "position_seconds": 0, "start_seconds": 2, "end_seconds": 8, "track": "2"}
set_clip_properties_tool {"timeline_clip_ids": ["<dancer>"], "properties": {"scale": "Crop", "volume": 0, "composite": "screen"}}
add_title_tool {"text": " ", "position_seconds": 0, "duration_seconds": 6, "background_color": "#000000", "track": "3"}
add_shape_mask_tool {"clip_ids": ["<black title>"], "shape": "ellipse", "x": 0.5, "y": 0.5, "width": 0.075, "height": 0.17, "feather": 0.0}
set_keyframes_tool {"timeline_clip_id": "<black title>", "property": "location_x", "points": [{"timeline_seconds": 0, "value": 0.05}, {"timeline_seconds": 0.125, "value": 0.046}], "interpolation": "bezier"}
set_keyframes_tool {"timeline_clip_id": "<black title>", "property": "location_y", "points": [{"timeline_seconds": 0, "value": -0.28}, {"timeline_seconds": 0.125, "value": -0.26}], "interpolation": "bezier"}
master_audio_tool {"target_lufs": -15, "true_peak_dbtp": -1.0, "balance": "keep"}
```

The two `location_x` / `location_y` points are the first of the track: write one
point per head position you read off the frames (every 0.125 s or so) for the
whole 6 s, or the oval stops at 0.125 s while the head moves on.

Keyframe values are `head_x - 0.5` and `head_y - 0.5` (frame fractions),
one point every 0.125 s or denser. The verified build measured them with
a 20-line OpenCV script (brightest figure on black, top of the torso
column; `~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/scripts/head.py`, local only), outside
Zenvi. The colour card plus `screen` lifts a black stage so a black oval
can be seen at all; on a lit set skip those two lines.

Missing: `tracked-face-mask` (a face tracker that drives a solid shape
layer and survives head turns). Fallbacks, best first: shoot it (a black
mask or wig on set); pick shots where the face is turned away or in
shadow; keep each occluded shot under 2 s and cut on the turn; keyframe by
eye every 2-3 frames on short shots.

## Timing & taste rules

- Oval about 1.2x the head: 7-8 % of frame width, 15-17 % of height on a
  full-body wide; hard edge (feather 0), pure black.
- Keyframes every 3 frames (0.125 s at 24 fps) at most; head turns and
  spins need every frame. Bezier between points.
- The oval must read: it needs a backdrop lighter than black. On a black
  stage it is invisible and the head just looks unlit.
- Never let it drift off on the turn; cut before a move you cannot cover.

## Sound for it

Nothing for the oval itself; it is a costume, not an effect. Music-led
mix (-14 to -16 LUFS), cuts on lyric lines and drops.

## Common mistakes

- Black oval on a black stage (the first judge pass saw no oval at all).
- Keyframes at 0.25-0.5 s: the oval lags and the profile shows on turns.
- A soft or semi-transparent oval; it reads as a blur, not a mask.
- Long continuous shots with fast spins and no tracker.

## Verified

2026-10-28. 6 s at 1280x720/24, Pexels dancer on a black stage, oval
keyframed every 0.125 s from OpenCV head positions. Pass 1 (black stage):
judge 2.82/10, "the black oval is completely absent", because black on
black. Lifted the stage to a violet card with `screen`: frames show the
oval on the head in most samples; judge 2.91/10, "the oval slips off the
face and reveals the performer's profile during rapid head turns". Not
good enough to fake: written as `needs: tracked-face-mask` with the
fallbacks above. Artifacts:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/faceless-performer-occlusion.*`.
