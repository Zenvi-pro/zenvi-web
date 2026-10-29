---
id: overhead-hands-only-recipe-overlays
kind: technique
summary: "When the viewer must cook along: top-down hands, 1-3 s per step, a step number, ingredient line and timer on screen."
categories: [food-recipe]
tools: [add_kinetic_title_tool, add_motion_block_tool, add_timer_tool, add_sfx_tool, kinetic_captions_tool]
pace: medium
mood: [helpful, clean, satisfying]
aspect: ["9:16", "1:1", "4:5"]
pairs_with: [cuts-on-audio-transients, hard-cut-chapter-title-cards, soft-bloom-lifted-shadow-grade]
avoid_with: [documentary-register-parody-kit, persistent-frame-mask-over-whole-video]
needs: [recipe-step-overlay]
---

# Overhead hands-only recipe overlays

## What it is
The Tasty grammar: overhead camera, only hands, one action per shot, and a
quiet layer of information: STEP n, the ingredient and quantity entering the
frame, a countdown on the simmer. Unverified in the watched corpus; this is the
genre's well-known form.

## Build it in Zenvi
Per step (shot start `s`):
```json
add_kinetic_title_tool {"text": "STEP 1", "position_seconds": "<s>", "duration_seconds": 1.8,
  "style": "stack", "animation": "slide_up", "text_size": 0.12, "y": 0.14}
add_motion_block_tool {"block": "lower_third", "position_seconds": "<s + 0.25>", "duration_seconds": 2.5,
  "params": {"name": "2 tbsp parsley, chopped", "role": "", "accent": "#f2b134"}}
add_sfx_tool {"recipe": "pop", "at_seconds": "<s + 0.25>", "gain_db": -18}
```
Cook time: `add_timer_tool {"mode": "count_down", "countdown_from_seconds": 240,
"screen_position": "top_right", "text_size": 0.05, "position_seconds": "<position_seconds>", "duration_seconds": "<duration_seconds>"}`.
Shots 2.5-3 s here because `lower_third` needs 2.5 s minimum; faster recipes
use `add_kinetic_title_tool` for the ingredient line instead (0.4 s minimum).
A card that builds as each ingredient enters needs `recipe-step-overlay`.

## Timing & taste rules
- One action per shot, 1-3 s; ingredient line on within 0.3 s of the
  ingredient entering frame.
- STEP number top-left, ingredient line lower third, timer top-right: three
  zones that never collide with the hands.
- Every clip's source must cover the shot (a clip that runs out shows black:
  the test's last step did until the in-point moved).

## Sound for it
A pop or tick per new label at -18 dB, real cooking foley (sizzle, chop) at
or above a light bed.

## Common mistakes
- Overlay longer than its shot (lands on the next step).
- Labels in three different type styles.
- Labels without sound: the judge called them "detached from the edit".

## Verified
2026-10-28: 8.6 s test, three stock overhead-ish shots (chop, oil, sauté),
STEP titles, ingredient lower thirds, a 4:00 countdown on step 3. First run:
`lower_third` refused 1.8 s (minimum 2.5); then a black tail from a short
source. Watch judge typography 6, overall 4.91; fixes: a closing beat and a
sound per label.
