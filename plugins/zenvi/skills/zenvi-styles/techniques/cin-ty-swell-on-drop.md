---
id: cin-ty-swell-on-drop
kind: technique
summary: "When the music builds to a drop: a small quiet word waits, then swells to hero size with 90 % of the growth on the beat."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [detect_beats_tool, add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [building, explosive]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cinematic-silence-before-hit, kcut-flood-climax]
avoid_with: [shot-crash-zoom-punch, cin-ty-kinetic-word-slams]
needs: []
drawn: cinetic
---

# Quiet type swells on the drop

cinetic `ty-swell-on-drop` · Typography in motion · signature · energy high · formats launch, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A word appears small and low-contrast and waits through the build, then swells to hero size, with 90% of the growth landing exactly on the beat drop.

Use when: A hero word or product name that should detonate on the drop after a quiet intro. The one appearance of the final wordmark when the music builds into the end. A single-word answer after a question beat.

## Build it in Zenvi

1. `detect_beats_tool {"file_id": "<music>"}` and take the downbeat `<drop>` (say 6.0 s).
2. `add_kinetic_title_tool {"text": "Everything.", "style": "creator", "animation": "fade", "stagger_seconds": 0, "ink": "#8a8f98", "text_size": 0.09, "position_seconds": 3.0, "duration_seconds": 4.0}` (about 9 % of the frame height, muted).
3. Swell: `set_keyframes_tool {"timeline_clip_id": "<title>", "property": "scale_x", "ease": "ease_in_out_expo", "points": [{"seconds": 5.47, "value": 1.0}, {"seconds": 6.0, "value": 2.3}, {"seconds": 6.37, "value": 2.5}]}` (same on `scale_y`; start 32 f, 0.53 s, before the drop, finish 22 f, 0.37 s, after).
4. Contrast rises together with size: `edit_title_tool` cannot animate, so duplicate the title in the ink colour on a track above and fade it in: `set_keyframes_tool {"property": "alpha", "points": [{"seconds": 5.47, "value": 0}, {"seconds": 6.0, "value": 1}]}`.
5. `add_sfx_tool {"recipe": "riser_noise", "at_seconds": 5.2, "gain_db": -16}` and `{"recipe": "impact_boom", "at_seconds": 6.0, "gain_db": -6}`.

## Timing & taste rules

- cinetic's timing (60 fps): Letters 5-6 f (0.10 s) apart at 9% of the frame height. Swell over 54 f (0.90 s) on ease_out_cubic, starting at h - 32 so 90% lands on h: scale 1 -> 2.5 (2.9 at most) in log space, with the outer edges of a 420 px word peaking at about 16.5 px/f around frame 17. Contrast goes C.mute -> ink over the 32 f (0.53 s) before h. Hold at most 54 f (0.90 s) after h, or 90-120 f (2.00 s) if this is the final lockup's one appearance.
- Start at about 9 % of frame height, width under 420 px so edges peak near 17 px/f during the swell.
- Swell 54 f (0.9 s) ease_in_out_expo starting 32 f (0.53 s) before the drop, scale 1 to 2.5 (2.9 at most) with 90 % of the growth landing on the drop.
- Colour runs muted to ink over the 32 f (0.53 s) before the drop.
- Hold at most 54 f (0.9 s) after the drop with a 0.3 px/f drift, or 90-120 f (1.5-2 s) for a final lockup.

## Sound for it

A riser underneath the build ending on the drop frame, then an impact_boom on that frame; no separate scale punch or camera kick.

## Common mistakes

- No real musical hit to land on.
- Words wide enough to swell past the safe area.
- Using it more than once per film, or stacking another punch on the same hit.
- Avoid when: There is no real musical hit to land on. Words wide enough to swell past the safe area. Using it more than once per film. Stacking a separate scale punch or camera kick on the same hit.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-swell-on-drop`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
