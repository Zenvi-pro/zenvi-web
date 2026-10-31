---
id: cin-cl-ink-resolve
kind: technique
summary: "When a headline or caption arrives over busy picture: words rise in pale and settle to full ink, never a bare fade."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, add_motion_block_tool, add_title_tool]
pace: calm
mood: [refined, soft, editorial]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-blur-slide, cin-cl-read-state-tone-ladder, cin-cl-type-solidity-arc]
avoid_with: [kinetic-word-pop, kinetic-beat-strobe]
needs: [per-word-colour-resolve]
drawn: cinetic
---

# Ink resolve on arrival

cinetic `cl-ink-resolve` · Colour and light · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Text never simply fades in: it arrives pale (or dim on a dark stage) and darkens or brightens to full ink as it settles.

Use when: Every headline and caption reveal, especially over textured or busy backgrounds where an opacity fade alone looks washed out.

## Build it in Zenvi

1. `add_kinetic_title_tool {"text": "Every frame earns its place", "style": "editorial", "animation": "rise", "ink": "#111111", "background": "#f2f0eb", "stagger_seconds": 0.13, "position_seconds": 0.5, "duration_seconds": 3.2}`: words rise about 20 f (0.33 s) and fade in together, 8 f (0.13 s) apart.
2. For a block headline, `add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 0.5, "duration_seconds": 3.2, "placement": "full_frame", "params": {"text": "Every frame earns its place", "style": "rise", "align": "center"}}` is the same move through a line mask.
3. Over busy footage, put a 30-40 % dark veil under the type so the pale-to-full resolve still reads: `add_title_tool {"text": " ", "background_color": "#00000066", "position_seconds": 0.5, "duration_seconds": 3.2, "fade_in_seconds": 0.3}` on a track below the title.
4. Numbers that must read instantly land at full ink with no resolve: use `add_title_tool` with no fade.

Fallback: Zenvi fades the word's opacity from 0, it cannot mix the word's colour from a pale tint to full ink. Get closest by stagger plus rise, and keep the type high contrast; do not fake it with a second pale copy.

## Timing & taste rules

- cinetic's timing (60 fps): Colour takes 12-16 f (0.27 s) per word on ease_out_expo (a headline-scale darkening may run 40 f (0.67 s)). The rise takes 20 f (0.33 s), peaking under 20 px/f. Stagger words 8 f (0.13 s) apart (4-10). Connector words go 0 to 0.5 in 2 f (0.03 s), then to 1 over 6-12 f (0.20 s).
- Colour resolve 12-16 f per word (0.2-0.27 s, ease_out_expo); a headline-scale darkening may run 40 f (0.67 s).
- Rise 20 f (0.33 s), peaking under 20 px per frame; at most 60 px travel.
- Stagger words 8 f (0.13 s), range 4-10 f (0.07-0.17 s).
- Connector words (on, and, the) reach half strength in 2 f and finish over the next 6-12 f, so the nouns read first.
- No blur on slow rises.

## Sound for it

Nothing, or one soft `swish_airy` (-16 dB) on the first word; never one per word.

## Common mistakes

- Numbers that must read instantly on a cut: land them at full ink instead.
- Type that already sits inside a colour-band fill; the two fights.
- Adding blur to a slow rise.
- Avoid when: Numbers that must read instantly on a cut (land them at full ink), or type that already sits inside a colour-band fill.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-ink-resolve`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
