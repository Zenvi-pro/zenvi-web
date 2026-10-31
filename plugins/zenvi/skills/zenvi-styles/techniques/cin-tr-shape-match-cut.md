---
id: cin-tr-shape-match-cut
kind: technique
summary: "When an object changes medium: it leaves one shot at a known point and size, the next opens on its match there."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [detect_subject_tool, align_match_cut_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [seamless, designed, precise]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [motion-pose-or-position-match-cut, cinematic-match-on-action, cin-tr-scale-through-cut]
avoid_with: [cin-tr-defocus-cut]
needs: []
drawn: cinetic
---

# Shape match cut

cinetic `tr-shape-match-cut` · Transition · workhorse · energy medium · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The hero shape leaves one shot at a known point and size, and the next shot opens on a matching shape (the mark, the flat UI, the real object) on the same point, so the object's identity carries across a change of world.

Use when: Turning a problem shape into the answer, a device mockup into the bare UI, or a physical object into the mark.

## Build it in Zenvi

1. Measure where the shape sits on the last frame of A and the first of B: `detect_subject_tool {"kind": "circle", "clip_id": "<A>", "time": <A_end>}` and the same for `<B>` at its first frame (for UI or type, read the box from `inspect_timeline_tool` instead).
2. Align them: `align_match_cut_tool {"clips": ["<A>","<B>"], "target": [0.5, 0.5], "fit": "contain", "zoom_drift": 0.02}` which writes scale/location keyframes so the centres agree within +/-20 px and the ratio stays within 0.57-1.3x.
3. Keep motion on both sides. Outgoing shrinks 2-4 % over its last 4 f (0.07 s): `set_keyframes_tool {"timeline_clip_id": "<A>", "property": "scale_x", "mode": "merge", "points": [{"seconds": <T-0.067>, "value": 1.0}, {"seconds": <T>, "value": 0.97, "ease": "ease_in_cubic"}]}` (and `scale_y`).
4. Incoming keeps going with no overshoot: `scale_x/scale_y` `[{"seconds": <T>, "value": 0.57}, {"seconds": <T+0.3>, "value": 1.0, "ease": "ease_out_expo"}]` (half the change in ~2 f).
5. Match colour, corner radius and stroke weight so only the medium changes (device screen to flat UI, coin emblem to logotype, circle to app icon); hold the result 12-30 f (0.2-0.5 s).

## Timing & taste rules

- cinetic's timing (60 fps): Cut in 0 f (0.00 s). Centre offset ≤ 20 px. Scale ratio 0.57-1.3x. Incoming settle 18 f (0.30 s) on ease_out_expo, with half the change done in about 2 f (0.03 s). Outgoing pre-cut shrink 4 f (0.07 s) on ease_in_cubic. Hold 12-30 f (0.50 s).
- Cut in 0 f; centre offset 20 px at most (1 % of the width); scale ratio 0.57-1.3x.
- Incoming settle 18 f (0.30 s) on ease_out_expo, half the change done in ~2 f (0.03 s).
- Outgoing pre-cut shrink 4 f (0.07 s) of 2-4 %.
- Hold the result 12-30 f (0.2-0.5 s) before it moves on.
- For a coin turn, rotateY-style: use a squash/zoom cut, not a rotation keyframe.

## Sound for it

A single soft hit or tick on the cut frame (`hit_transient` at -16 dB); the object's identity carrying across is the effect.

## Common mistakes

- Silhouettes differ (round against tall), so the match cannot be seen (avoid_when): use a dot relay or an iris.
- Stopping motion on one side: the cut then looks like a freeze.
- Mismatched corner radius or colour: the viewer sees two objects, not one changing medium.
- Avoid when: The silhouettes differ (round against tall), so the match cannot be seen. Use a dot relay or a container morph instead.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-shape-match-cut`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
