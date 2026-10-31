---
id: cin-ty-step-edit-performs-copy
kind: technique
summary: "When the copy is about fixing, undoing or simplifying: the headline does it in one-frame steps, no tween."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [deadpan, witty]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-collapse-cut, shot-type-to-pill]
avoid_with: [cin-ty-inplace-light-up-beats, cin-ty-kinetic-word-slams]
needs: []
drawn: cinetic
---

# Hard-step edits that act out the copy

cinetic `ty-step-edit-performs-copy` · Typography in motion · accent · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The headline does what it says with one-frame edits: broken words click straight one at a time, or words delete from the end faster and faster.

Use when: Copy about fixing, undoing, cleaning up or simplifying; a deadpan joke beat; a problem line that should visibly go away.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Broken state uses rotation only: `add_title_tool {"text": "Messy, tangled, slow.", ...}` with `set_keyframes_tool {"property": "rotation", "points": [{"seconds": 2.0, "value": -20}, {"seconds": 2.1, "value": -20}]}`; for per-letter fanning split the word into letter titles rotated (j - mid) x 6 degrees and raised (j - mid)^2 x 2 px. No slanted skew state, which fakes an italic.
2. Steps, punches, accelerating delete (10/5/5/2 f, 0.17/0.08/0.08/0.03 s) and the rising `keyboard_key` clicks exactly as in the full build.

**Full look** (relies on italic: only when the person's brand supplies that look):

1. Broken state: `add_title_tool {"text": "Messy, tangled, slow.", "template": "Standard_1", "position_seconds": 2.0, "duration_seconds": 0.1, "track": "3"}` and tilt it with `set_keyframes_tool {"timeline_clip_id": "<broken>", "property": "rotation", "points": [{"seconds": 2.0, "value": -20}, {"seconds": 2.1, "value": -22}]}`; a drift of 0.5 px/f is the tiny `location_x` slide over the clip.
2. Fix steps are hard cuts between title clips, no tween: one clip per state, at +6 f, +26 f, +40 f after the cut (0.1 s, 0.43 s, 0.67 s): `add_title_tool {"text": "Clean, tangled, slow.", "position_seconds": 2.1, ...}` and so on, each word upright as it is fixed.
3. 2 % punch on the newly fixed word's clip: `scale_x/y` 1.0, 1.02 (0.03 s, ease_out_expo), 1.0 at 0.07 s.
4. Delete variant: successive title clips with the words cut from the end, held 10, 5, 5, 2 f (0.17, 0.08, 0.08, 0.03 s).
5. A `keyboard_key` click per step, each a little louder: `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 2.1, "gain_db": -20}`, then -18, -16.

## Timing & taste rules

- cinetic's timing (60 fps): Snap 1 f (0.02 s), no tween; fix intervals 20 then 14 f (0.23 s); delete intervals 10/5/5/2 f (0.03 s); broken-state drift 0.5 px/f; click within 1 f (0.02 s) of each step; hold the fixed line at least 42 f (0.70 s).
- Snap is 1 f with no tween; fix intervals 20 then 14 f (0.33 s, 0.23 s) after the first step at +6 f.
- Delete variant intervals 10/5/5/2 f, building pressure into the cut.
- Broken-state drift 0.5 px/f; 2 % punch per step; hold the fixed line at least 42 f (0.7 s).
- Click within 1 f of every step, each louder than the last by about 2 dB.

## Sound for it

A keyboard_key click on each step frame, rising from -20 to -16 dB; nothing on the tilts themselves.

## Common mistakes

- Copy the motion would contradict, or calm films.
- More than one per film: it is the one discrete trick.
- Tweening the states: the one-frame snap is the joke.
- Avoid when: Copy the motion would contradict; calm films; more than one per film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-step-edit-performs-copy`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
