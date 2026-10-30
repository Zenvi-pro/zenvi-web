---
id: slide-in-pill-badge-and-name-cards
kind: technique
summary: "When a speaker, price or fact needs a label: name card or pill slides/pops in about 10 frames with a soft cue."
categories: [podcast-clip-vertical, tech-review]
tools: [add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool, preview_frame, add_title_tool]
pace: medium
mood: [informative, polished, friendly]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [karaoke-word-highlight-captions, angle-switching-on-speech, ui-card-over-the-speaker]
avoid_with: [persistent-frame-mask-over-whole-video]
needs: []
---

# Slide-in pill, badge and name cards

## What it is
A name and role card when a speaker's turn starts, or a small pill with the
fact being said ("$4 a cup"), sliding or popping in over about 10 frames, held
1.4-3 s, gone before the next idea. Context on mute without leaving the face.

## Build it in Zenvi
1. Speaker card at the turn start (+0.3-0.5 s):
   ```json
   add_motion_block_tool {"block": "lower_third", "position_seconds": 0.4,
     "duration_seconds": 3.2, "params": {"name": "Sam Rivera",
     "role": "Founder, Northwind Coffee", "accent": "#ffd400"}}
   ```
   (2.5 s minimum; `style: "bar"` in params for a solid bar behind the name.)
2. Fact pill on the spoken word: `add_kinetic_title_tool {"text": "$4 a cup",
   "position_seconds": <word start>, "duration_seconds": 1.6, "style": "creator",
   "animation": "pop", "emphasis": ["$4"], "y": 0.74}`; `y` below the chin, never 0.3
   on a centred face (it covered the face in the test until moved).
3. Sound: `add_sfx_tool {"recipe": "whoosh_short", "gain_db": -20}` on the card,
   `"pop"` at -16 on the pill.
4. `preview_frame` at entry + 0.5 s: card clear of mouth and captions.

## Timing & taste rules
- Entrance 8-12 frames with a small overshoot; exit as fast or faster.
- Card 1.4-3.2 s; a pill 1-1.6 s; one label on screen at a time.
- Name 4-5 % frame height, role about 60 % of that; one accent colour shared
  with the captions.
- Upper third or lower third, never where the captions live.

## Sound for it
Whoosh -20 dB under voice on the slide, pop or click -16 on the pill; never
the same sample twice within 3 s.

## Common mistakes
- Labels held for the whole clip: they become furniture.
- A display-face pill in one style and a serif card in another: pick one
  type system (the judge marked the mix as incoherent).
- Pill over the face or the caption line.

## Verified
2026-10-28: 6 s podcast test (stock), lower_third at 0.4 s, "$4 a cup" pop at
3.9 s, whoosh + pop. The pill first sat at y 0.3 over the face; moved to 0.74.
Watch judge typography 4, overall 4.18: wanted a rounded pill for the name and
one coherent type style; the lower_third block draws a rule, not a pill, so for
a pill use `add_kinetic_title_tool` with a `background` colour card or
`add_title_tool` with a boxed template.
