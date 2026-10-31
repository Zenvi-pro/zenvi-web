---
id: cin-lc-opposite-corner-relay
kind: technique
summary: "When two claims share one held shot: one caption fades from a top corner as the next builds in the mirrored corner."
categories: [cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, add_kinetic_title_tool]
pace: calm
mood: [quiet, guided, editorial]
aspect: ["16:9", "1:1"]
pairs_with: [cin-lc-negative-space-caption, cin-ps-locked-camera-holds, shot-blur-slide]
avoid_with: [cin-lc-icon-ragged-stack]
needs: []
drawn: cinetic
---

# Opposite-corner caption relay

cinetic `lc-opposite-corner-relay` · Layout and composition · accent · energy calm · formats walkthrough, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

One caption fades out of one upper corner while the next starts building in the mirrored corner, so the eye travels across a locked frame and that travel is the motion.

Use when: Two consecutive beats over one held product shot with no camera move or cut; alternating claims about one screen.

## Build it in Zenvi

1. Held product shot with a slow breath so it is never frozen: `set_keyframes_tool {"timeline_clip_id": "<shot>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 6, "value": 1.02, "ease": "ease_in_out_sine"}]}` and the same for `scale_y` (or a 0.3 px/f drift on `location_x`).
2. Caption A top-left: `add_kinetic_title_tool {"text": "<claim one>", "style": "documentary", "animation": "rise", "position_seconds": 0.3, "duration_seconds": 2.4, "y": 0.12, "stagger_seconds": 0.133}`; move it to the left corner with `set_keyframes_tool` `location_x` of -0.3 on its clips. It exits with `alpha` 1 to 0 over 28 f (0.47 s), `ease_in_out_sine`, and does not move.
3. Caption B in the mirrored corner on the same baseline: the same call with the text of claim two, `y` 0.12, `position_seconds` 2.4 s (A's exit begins at 2.23 s; B starts 10 f, 0.17 s later), `location_x` +0.3. Overlap is 18 f (0.3 s).
4. Each caption stays readable at least 48-60 f (0.8-1.0 s) before it exits.

## Timing & taste rules

- cinetic's timing (60 fps): A fades over 28 f (0.47 s) on ease_in_out_sine; B starts 10 f (0.17 s) after A's exit begins; 18 f (0.30 s) of overlap. Each caption stays readable for at least 48-60 f (1.00 s).
- A fades over 28 f (0.47 s) on ease_in_out_sine; B starts 10 f (0.17 s) after A's exit begins; overlap 18 f (0.3 s).
- Same baseline and same inset from the safe edge for both captions.
- Each caption readable 48-60 f (0.8-1.0 s) minimum.
- Product shot on a 2 % breath or 0.3 px/f drift: the relay is the event, not the camera.
- Twice at most in one film.

## Sound for it

None.

## Common mistakes

- Captions longer than a short line: the eye cannot finish A while B starts.
- Using the relay for every caption change: past two uses it reads as a device.
- Moving caption A while it fades; it stays put.
- Avoid when: Captions longer than a short line (the eye cannot finish A while B starts), or as the default for every caption change; repeated more than twice it reads as a device.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-opposite-corner-relay`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
