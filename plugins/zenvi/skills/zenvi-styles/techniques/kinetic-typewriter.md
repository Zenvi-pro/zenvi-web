---
id: kinetic-typewriter
kind: technique
summary: "When text should feel typed, logged or confessed: letters appear one by one at typing speed, no fade."
categories: [documentary-true-story, tech-review, saas-app-launch, animated-explainer, video-essay-explainer, kinetic-type-motion-design]
tools: [add_kinetic_title_tool, add_motion_template_tool, add_motion_block_tool, add_sfx_tool]
pace: calm
mood: [intimate, technical, suspense]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [kinetic-scramble-decode, kinetic-counter, kinetic-title-sequence]
avoid_with: [kinetic-word-pop, kinetic-letter-cascade, kinetic-beat-strobe]
needs: []
---

# Typewriter

## What it is
A line typed letter by letter at about 12-20 characters a second, no fade, the finished line held. For log lines,
dates and places, "I asked the AI…" hooks and documentary captions.

## Build it in Zenvi
```json
add_kinetic_title_tool {"text": "2 terabytes in your pocket", "style": "documentary", "animation": "typewriter",
  "position_seconds": 0.4, "duration_seconds": 3.8, "text_size": 0.1, "y": 0.5}
add_sfx_tool {"recipe": "typing_burst", "at_seconds": 0.4, "align": "start", "duration": 1.4, "gain_db": -16}
```
Native: one title clip and a stepping `Crop` effect, so it plays the same on every surface. A prompt box with a caret is
`add_motion_block_tool {"block": "prompt_bar"}` or `add_motion_template_tool {"template": "type_search"}`.

## Timing & taste rules
- Typing takes ≤ 40 % of the hold; the finished line is held ≥ 1 s (readable typing: ≥ 4 % of frame height).
- 12-20 chars/s; slower drags, faster is a flash.
- One line at a time; a second line types only after the first has been read.
- Mono or a plain sans: documentary (Inter) or mono labels; never the condensed display face.

## Sound for it
Keyboard foley under the typing window only, -20 to -26 dB per key (typing_burst at -16 dB clip gain sits about
there under a bed); stop the sound when the last letter lands.

## Common mistakes
- Typing a long sentence (> 40 characters): split it or cut it.
- Typing sound running past the last letter.
- Fading the typed text in as well as typing it.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-typewriter.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-typewriter.mp4` and its contact sheet. Checked on the sheet: the line types in about 1.3 s with no fade, then holds; keyboard foley only under the typing. Watch judge (absolute, isolated 3-5 s test): **4.6/10** overall, typography 6; its main note: "The clip abruptly cuts off mid-motion while hands are still closing the drive bays, leaving the viewer hanging.".
