---
id: shot-card-stack-fan
kind: technique
summary: "When a set of things must read as one weighty object, then as many: cards land in an accelerating stack, then fan open."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, 3d-product-cgi-ad, tech-review]
tools: [add_3d_scene_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [tactile, confident, rich]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-stack-press-count, kinetic-lower-third, T062]
avoid_with: [shot-bento-light-up, shot-page-waterfall-wall]
needs: [video-card-cascade-layout]
---

# Card stack, then fan (the deal)

## What it is
Cards drop onto a table one after another, each faster than the last, forming one heavy stack; once all have landed the stack
opens in a hand-of-cards fan, and (optionally) the centre card is pulled out as the hero. First the whole, then the parts:
the viewer remembers the amount first, the variety second. Also the long "deal" version: a pile of cards dealt hard-accelerating
into a grid while the camera climbs to a bird's-eye of the full board.

## Build it in Zenvi
The 3D scene does the stack and the fan (verified, 5 cards printed with clips, 4.5 s):
```json
add_3d_scene_tool {"scene": "card_stack", "position_seconds": 0, "duration_seconds": 3.5, "quality": "final",
  "params": {"animation": "fan", "kind": "card", "count": 5, "background": "dark", "elevation": 58, "fan_degrees": 11,
  "size": 0.7, "dof": false, "accent": "#3d6bff", "file_ids": ["<a>", "<b>", "<c>", "<d>", "<e>"]}}
add_sfx_tool {"recipe": "paper", "at_seconds": 0.3, "gain_db": -20, "seed": 1}   // then +0.22 s each, seeds 2-5
add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 2.0, "gain_db": -18}      // as the fan opens
```
Use an odd count so a centre card exists. For the pull-out add a title after the fan:
`add_kinetic_title_tool {"text": "Start from a recipe", "style": "editorial", "animation": "rise", "position_seconds": 2.4}`.
Not available: a grid deal onto a page with a rising chase camera (`needs: video-card-cascade-layout`); for "many projects
pour in" use `drop` with `count: 12` and a draft first (`quality: draft`).

## Timing & taste rules
- Landing intervals shrink (about 1.6 s of the original 40 f spread over 9 cards): ease-out spacing, never even.
- Fan: 6.5 degrees per card, 138 px shift each at 1080p, one slight overshoot (hand-wrist inertia); 9 cards = 52 degrees
  is the comfortable maximum, past 11 cards cut the angle to 4-5 degrees.
- The pivot is below the card (130 % of its height): a pivot at the card centre makes a windmill.
- Stack tightens 2 % just before opening (anticipation); camera pushes in ~6 % on the stack, pulls out to ~0.88 for the fan.
- Pull-out of the hero card only 70-100 px with a 3 px outline; under 40 px it does not read as chosen.
- Do not run the 3D scene longer than 3.5 s: the stack and fan are done by about 1.8 s and the rest is a hold.

## Sound for it
A soft `paper` hit per card (varied seeds, -20 dB, quieter as they speed up; past 8 cards fade to one swish), a
`whoosh_medium` as the fan opens, one `impact_thud` when the hero card is pulled out.

## Common mistakes
- All cards flying at the same time (an explosion); or even spacing (a roll call).
- Opening the fan while the last card is still falling.
- Even card count with a centre-card pull-out (the hero lands off-centre).
- Fake-looking cards: print real clips or screens on them, not flat colours.

## Verified
2026-10-29, CLI on five bench clips: scripts/shot-card-stack-fan.sh → shots/shot-card-stack-fan.mp4 (local only; Blender render about 5 min). Checked on the sheet: cards tumble from the top edge into a stack by about 1.2 s, the stack fans by about 1.8 s, then holds for the rest of the 4.5 s; picture on every card. Watch judge (absolute): **4.9/10**; main note: "The accelerated stacking motion and subsequent fan-out effectively demonstrate the core technical brief. However, the movement lacks elastic overshoot and natural spatial depth, feeling somewhat linear and mechanical."

Adapted from video-shotcraft cards `shots/ui-entrance/card-stack.md` and `shots/ui-entrance/deck-deal-flyin.md` (Apache-2.0; see ../NOTICE).
