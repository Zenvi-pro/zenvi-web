---
id: kinetic-letter-cascade
kind: technique
summary: "When a single word or name is the moment: its letters bounce in one by one with a 1-2 frame stagger."
categories: [kinetic-type-motion-design, kids-education, brand-story-corporate, automotive-ad, sports-hype-edit, gaming-montage]
tools: [add_kinetic_title_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [playful, confident, crafted]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [kinetic-mask-reveal, kinetic-3d-title, kinetic-title-sequence]
avoid_with: [kinetic-word-pop, kinetic-typewriter, kinetic-scramble-decode]
needs: []
---

# Per-letter cascade

## What it is
One word (a name, a product, a place) assembled letter by letter: each letter scales/bounces in 1-2 frames after the
one before, settles with a small overshoot, then holds. The spring wordmark lockup of brand reels.

## Build it in Zenvi
```json
add_kinetic_title_tool {"text": "NIGHTSHIFT", "style": "stack", "animation": "letters", "position_seconds": 0.3,
  "duration_seconds": 3, "stagger_seconds": 0.05, "text_size": 0.26, "y": 0.5}
add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 0.75}
add_sfx_tool {"recipe": "hit_transient", "at_seconds": 0.8}
```
Each letter is its own native clip, so letters can be recoloured or moved afterwards (that is how kinetic-text-on-path
is built). Headline-sized with a mask: `add_motion_block_tool {"block": "kinetic_headline", "params": {"style": "pop"}}`.

## Timing & taste rules
- Stagger 0.033-0.066 s (1-2 frames at 30 fps): the whole word lands in ≤ 0.6 s.
- Overshoot 105-115 %, never more; the best pieces settle, the average bounce.
- Hold the finished word ≥ 1.5 s when it is the lockup; then a cut or a stinger, no fade.
- One word (≤ 12 letters); a sentence cascading letter by letter is unreadable.
- Second layer of motion (families/kinetic.md rule 2): while the type holds, the picture keeps moving — push the
  footage or backdrop 1.0 → 1.06 over the shot with `set_keyframes_tool` on that clip (not on the title clips).

## Sound for it
A rising whoosh that peaks as the last letter lands plus one hit on the landing; or per-letter micro ticks at -24 dB
for a playful piece (kids, UI), never both.

## Common mistakes
- Stagger too slow (0.1 s+ per letter): the word reads as a typing effect.
- A cascade on every title of the edit.
- Left-aligned stack style on a centred composition: check `y`/alignment against the shot.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-letter-cascade.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-letter-cascade.mp4` and its contact sheet. Checked on the sheet: ten letters land within 0.5 s and hold; the judge found the native letter pop plain (no secondary bounce). Watch judge (absolute, isolated 3-5 s test): **3.8/10** overall, typography 4; its main note: "The text 'NIGHTSHIFT' pops in linearly without organic bounce, overshoot, or proper kinetic easing.".
