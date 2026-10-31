---
id: beat-locked-kinetic-type-cuts
kind: technique
summary: "For type-led hooks and teasers: one word per beat hard-cut on alternating grounds, ending in a quiet lockup on a hit."
categories: [gaming-montage, kinetic-type-motion-design]
tools: [detect_beats_tool, add_kinetic_title_tool, add_sfx_tool, automate_volume_tool, set_keyframes_tool, add_motion_block_tool]
pace: frantic
mood: [punchy, graphic, bold]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [stacked-word-flipper, tiled-video-wall, prompt-bar-typing-hero, grid-cell-reflow-and-collapse]
avoid_with: [commentary-hits-with-dense-designed-cues, comic-burst-insert]
needs: [type-strobe-sequencer, typographic-layout-variants]
---

# Beat-locked kinetic type cuts

## What it is
Words or a logotype hard-cut on beats or vocal hits (every 0.4-0.5 s, or 3-6
frames for a strobe), the ground and ink inverting every word, then a sudden
calm lockup at 9-12 % height with its own sound. Valorant's teaser and the
bold-to-light type reels are this; it is also the hook of a gaming montage.

## Build it in Zenvi
```json
detect_beats_tool {"file_id": "<music>"}
add_kinetic_title_tool {"text": "PLAY", "position_seconds": <beat i>, "duration_seconds": <max(0.4, beat gap)>,
  "style": "creator", "animation": "slam", "stagger_seconds": 0, "emphasis": ["PLAY"],
  "accent": "<ink>", "background": "<ground>", "text_size": 0.12, "y": <0.42 / 0.5 / 0.58>}
add_kinetic_title_tool {... next word, accent and background swapped ...}
add_kinetic_title_tool {"text": "PLAY AGAIN", "position_seconds": <end>, "duration_seconds": 2, "style": "stack",
  "animation": "fade", "emphasis": "none", "ink": "#ffffff", "background": "<ink>", "text_size": 0.09}
add_sfx_tool {"recipe": "hit_transient", "at_seconds": <every other beat>, "gain_db": -9}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": <lockup>, "gain_db": -5}
automate_volume_tool {"role": "music", "shape": "suck_out", "at_seconds": <lockup>, "length_ms": 150, "db": -20}
```
- `creator` with the word as its own `emphasis` sets one centred word that
  fills the width (about 22 % of height on 9:16). `stack` stays left-aligned
  and small; scaling a title clip scales about the frame centre and pushes a
  left-aligned word off frame.
- `duration_seconds` has a 0.4 s minimum, so one word per beat works up to
  150 bpm; 3-6 frame strobes need `type-strobe-sequencer`, and cropped /
  mirrored / outline layouts of one word need `typographic-layout-variants`.
- The K family (`kinetic-*` techniques) has the per-letter and scramble
  variants; this one is the cut-on-the-beat skeleton.

## Timing & taste rules
- One idea per beat; 6-10 words, then the lockup (DTU: 18 holds in 12 s).
- Vary the y between 0.42, 0.5 and 0.58 so the eye moves; vary nothing else.
- Two colours, one inversion rule; a third colour only on the lockup.
- The lockup holds 1.5-2 s, quiet, after a 150 ms suck-out.

## Sound for it
A hit on every other word and a light tick on the others (music-only pieces
are allowed, but the best reels sound every change); a boom + sub on the
lockup.

## Common mistakes
- Uniform small words (pass 1, judge 4.09: "minimal hierarchy").
- Harsh full-frame strobing for more than 4 s (judge flags flicker).

## Verified
2026-10-29: 4.8 s 9:16 tests on the trap bed's beats (0.4 s). Pass 1 (stack
style): words ~10 % of height, 4.09. Pass 2 (creator emphasis, y varied,
boom + sub + suck-out on the lockup): 4.36; the judge wants a scale punch on
each word and some texture on the flat grounds.
