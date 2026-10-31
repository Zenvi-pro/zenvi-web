---
id: cin-lc-gap-open-insert
kind: technique
summary: "When a sentence should hold its object: the words part and an icon or photo pops into the gap."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_clip_to_timeline_tool, add_sfx_tool]
pace: medium
mood: [playful, clever, crisp]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [cin-lc-hero-flips-to-inline-glyph, kinetic-letter-swap, kinetic-emphasis-scale]
avoid_with: [cin-lc-one-centred-subject]
needs: [inline-glyph-slot]
drawn: cinetic
---

# Words part for an inserted object

cinetic `lc-gap-open-insert` · Layout and composition · workhorse · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Inside a finished line, the words slide apart to open a gap and an object pops into it (an icon, a photo, a token, or a caret that grows into a container), so the sentence becomes a frame for the object.

Use when: Making a sentence about the object literally contain it (a product photo in a claim, a lock icon beside 'private', a prompt box between two words); morphing a headline into the first UI element of the next scene.

## Build it in Zenvi

1. Split the line into two titles: left group `add_title_tool {"template": "Standard_1", "text": "Your data stays", "position_seconds": 0, "duration_seconds": 3, "track": 3}` and right group `"text": "private"`, both centred; the line is read as complete for the first beat.
2. Open the gap: `set_keyframes_tool {"timeline_clip_id": "<left>", "property": "location_x", "mode": "replace", "points": [{"seconds": 0.8, "value": 0}, {"seconds": 1.07, "value": "<-w/2>", "ease": "ease_in_out_sine"}]}` and `<right>` to `+w/2`, w the object's width as a fraction of the frame (for a 200 px gap, 0.104). Gap opens over 16 f (0.27 s), under 20 px/f per side.
3. Pop the object into the slot once the gap is 70 % open (about 0.99 s): `add_clip_to_timeline_tool {"file_id": "<object>", "position_seconds": 0.99, "duration_seconds": 2.0, "track": 4}` with `scale_x` and `scale_y` 0 to 1 over 6 f (0.1 s), `ease_out_cubic` (no overshoot).
4. Make the object the next scene, if needed: groups accelerate apart over 16 f (0.27 s) with `ease_in_cubic` and `alpha` to 0, while the object's `scale_x/y` grows to the next shot's rect over 8-20 f (0.13-0.33 s).
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 0.99, "gain_db": -12}`.

Fallback: The caret-to-capsule growth (a hairline widening into a UI element) is not available; use a pop-in.

## Timing & taste rules

- cinetic's timing (60 fps): Gap opens over 16 f (0.27 s) on ease_out_cubic, which keeps a 200 px gap under 20 px/f per side. Object pop 6 f (0.10 s) on ease_out_cubic. Hold 14-60 f (1.00 s). Exit: words 16 f (0.27 s) on ease_in_cubic, object scale-up 8-20 f (0.33 s) into the cut. Caret variant: grow 6 f (0.10 s), hold 8 f (0.13 s), thicken 14 f (0.23 s), widen 24-62 f (1.03 s).
- Gap opens 16 f (0.27 s) on ease_in_out_sine; object pop 6 f (0.1 s), no overshoot; hold 14-60 f (0.23-1.0 s).
- Move groups with location keyframes, never by re-laying the line.
- Exit: words 16 f (0.27 s) on ease_in_cubic, object scale-up 8-20 f (0.13-0.33 s) into the cut.
- Caret variant timing: grow 6 f, hold 8 f, thicken 14 f, widen 24-62 f (0.1, 0.13, 0.23, 0.4-1.03 s).

## Sound for it

One small pop as the object lands; nothing as the words part.

## Common mistakes

- Long lines whose parted words would leave the frame.
- An object that needs more room than a word gap: use a push-aside or a cut.
- Overshooting the pop: it should fit the slot exactly.
- Avoid when: Long lines whose parted words would leave the frame unintentionally, or an object that needs more room than a word gap can give (use a push-aside or a cut).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-gap-open-insert`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
