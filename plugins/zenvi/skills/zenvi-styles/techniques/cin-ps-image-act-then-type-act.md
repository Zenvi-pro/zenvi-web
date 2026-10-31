---
id: cin-ps-image-act-then-type-act
kind: technique
summary: "When a 6-12 s spot has one claim: half pure imagery with no words, then half pure type with no imagery."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clips_to_timeline_tool, set_keyframes_tool, add_kinetic_title_tool, add_motion_block_tool]
pace: medium
mood: [clean, bold, mute-friendly]
aspect: ["9:16", "16:9", "1:1", "4:5"]
pairs_with: [cin-ps-breath-envelope, kinetic-keyword-slam, t119]
avoid_with: [cin-ps-four-sequence-launch, kinetic-vo-captions]
needs: []
drawn: cinetic
---

# Image act, then type act

cinetic `ps-image-act-then-type-act` · Pacing and structure · workhorse · energy medium · formats feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A short spot splits in half: the first half is pure imagery with no words at all, the second is pure type with no imagery.

Use when: 6-12 s spots and social cut-downs with one claim and a strong visual metaphor, especially when watched on mute.

## Build it in Zenvi

1. Act 1, three image shots of 70-90 f (1.17-1.5 s) each, no text track at all: `add_clips_to_timeline_tool {"file_ids": ["<img1>", "<img2>", "<img3>"], "track": 1, "start_seconds": 0, "image_seconds": 1.33}`. Each shot ends on an accelerating exit: `set_keyframes_tool {"timeline_clip_id": "<shot_i>", "property": "location_x", "mode": "replace", "points": [{"seconds": 0, "value": 0}, {"seconds": 1.07, "value": 0}, {"seconds": 1.33, "value": -0.12, "ease": "ease_in_cubic"}]}`.
2. Act 2, type only on a plain ground (black card on track 1, no footage): claim 70-80 f (1.17-1.33 s), headline 60-70 f (1-1.17 s), CTA 60 f (1 s), then lockup 90-110 f (1.5-1.83 s): `add_kinetic_title_tool {"text": "<claim>", "style": "creator", "animation": "pop", "position_seconds": 4.0, "duration_seconds": 1.25}`, then the headline at 5.25 s, the CTA at 6.4 s, `add_motion_block_tool {"block": "logo_reveal_end", "position_seconds": 7.4, "duration_seconds": 2.0}`.
3. The first type card continues act 1's screen direction across the seam: enter from the right if the last image left toward the left.
4. Keep image tracks below 3 and type tracks above 4 so neither act can leak; run each type card on a three-term scale curve (arrive, drift, exit).
5. Total 480-600 f (8-10 s).

## Timing & taste rules

- cinetic's timing (60 fps): Total 480-600 f (10.00 s). Act 1: 3 shots of 70-90 f (1.50 s). Act 2: claim 70-80 f (1.33 s), headline 60-70 f (1.17 s), CTA 60 f (1.00 s), then lockup 90-110 f (1.83 s).
- Total 480-600 f (8-10 s); split about 47/53 %.
- Act 1: 3 shots of 70-90 f (1.17-1.5 s). Act 2: claim 70-80 f, headline 60-70 f, CTA 60 f, lockup 90-110 f (1.5-1.83 s).
- No text in act 1 and no imagery in act 2: that purity is the point.
- Each shot ends on an accelerating exit (ease_in_cubic) and the seam continues screen direction.

## Sound for it

A single whoosh_short on the seam; a hit on the claim; a soft ui_tap or pop on the CTA.

## Common mistakes

- Product walkthroughs that need captions on the UI.
- Films over 20 s: the two-act purity gets tiresome.
- Leaking a word into act 1 or a picture into act 2.
- Avoid when: Product walkthroughs that need captions on the UI, and films over 20 s.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-image-act-then-type-act`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
