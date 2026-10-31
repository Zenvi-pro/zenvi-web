---
id: cin-le-reverse-type-recentre
kind: technique
summary: "When a persona product gets its name: the name types backwards from its last letter while the mark is pushed outward."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [curious, smooth]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, prompt-bar-typing-hero]
avoid_with: [cin-le-mark-slide-name-follow, kinetic-typewriter]
needs: [reverse-order-letter-reveal]
drawn: cinetic
---

# Name types backwards, group stays centred

cinetic `le-reverse-type-recentre` · Logo and end card · accent · energy calm · formats launch, feature, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The name appears from its last letter to its first while the mark is pushed outward, so the lockup grows out of the mark's edge and stays centred on every frame.

Use when: Agent, assistant or persona products whose mark is an avatar or a disc. Names of 4-12 characters. A centred lockup that must never jump.

## Build it in Zenvi

1. Mark centred, name letters each a single-letter title in their final slots (measured on `inspect_timeline_tool`): `add_clip_to_timeline_tool {"file_id": "<disc>", "position_seconds": 1.0, "duration_seconds": 4.0, "track": "3"}`; for each letter `add_title_tool {"text": "<ch>", "template": "Standard_1", "position_seconds": <t_i>, "duration_seconds": <rest>, "track": "4"}`.
2. Letter i (n letters) appears at 1.0 + 0.058 x (n-1-i) s (3.5 f apart, 10 letters inside 36 f, 0.6 s) with `alpha` 0 to 1 over 0.067 s, so the name grows leftward from its last letter.
3. Keep the group centred by moving everything left/right as the width grows: on every letter and the mark, `location_x` keyframes shifting by half each new advance with `ease_in_out_sine`, 20 f (0.33 s) to settle each step (the mark travels about 270 px at 7-8 px/f).
4. If the story device is a dot, darken it into the mark first: `alpha` crossfade dot to mark over 12 f (0.2 s).
5. `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 1.0, "gain_db": -26}` on the first and last letters only.

Fallback: A reverse reveal is not an option of the type tools; the same result is built from per-letter titles. Without that effort, type the name forward with add_kinetic_title_tool typewriter and re-centre.

## Timing & taste rules

- cinetic's timing (60 fps): 3.5 f (0.06 s) per character (10 characters in 36 f (0.60 s)), each fading in over 4 f (0.07 s) on ease_in_out_cubic. Each width step eases on ease_out_quart (no overshoot, ~20 f (0.33 s) to settle). The mark travels ~270 px at 7-8 px/f on average. Dot-to-mark darkening takes 12 f (0.20 s). The lockup settles ~20 f (0.33 s) after the last character, then holds 90-120 f (2.00 s) under a 10-15% push (le-living-hold).
- 3.5 f (0.06 s) per character, each fading in over 4 f (0.07 s); 10 characters in 36 f (0.6 s).
- Each width step eases without overshoot, about 20 f (0.33 s) to settle.
- Lockup settles about 20 f (0.33 s) after the last character, then holds 90-120 f (1.5-2 s) under a 10-15 % push.
- Names of 4-12 characters.

## Sound for it

Two soft key taps (first and last letter) at -26 dB; not one per letter.

## Common mistakes

- Two-word names whose second word makes no sense on its own first.
- Right-to-left scripts, where it becomes an ordinary type-on.
- A headline that already used a typewriter.
- Avoid when: Two-word names whose second word makes no sense on its own first. Right-to-left scripts (it becomes an ordinary type-on). The headline already used a typewriter.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-reverse-type-recentre`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
