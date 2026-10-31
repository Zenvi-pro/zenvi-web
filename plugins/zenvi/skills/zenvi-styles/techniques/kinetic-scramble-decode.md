---
id: kinetic-scramble-decode
kind: technique
summary: "When a spec, label or tech claim should feel computed: random glyphs decode left to right into the text."
categories: [tech-review, saas-app-launch, product-launch-film, gaming-montage, movie-game-trailer, kinetic-type-motion-design, automotive-ad]
tools: [add_motion_block_tool, add_kinetic_title_tool, kinetic_captions_tool, add_sfx_tool]
pace: medium
mood: [technical, futuristic, precise]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [kinetic-counter, kinetic-tracked-label, kinetic-typewriter]
avoid_with: [kinetic-quote-card, kinetic-lyric-sync, kinetic-letter-cascade]
needs: []
---

# Scramble / decode

## What it is
Text resolves out of random glyphs (letters, symbols, binary, blocks) from left to right, an accent block riding the
decode front. HUD labels, specs and numbers, "491GB"-style captions.

## Build it in Zenvi
Motion block (best look; needs headless Chrome — the CLI, MCP and Cloud):
```json
add_motion_block_tool {"block": "text_scramble", "position_seconds": 0.3, "duration_seconds": 3.5,
  "params": {"text": "READ 7450 MBPS / WRITE 6900 MBPS", "size": 96, "glyphs": "symbols", "label": "SPEC · 01",
             "palette": "mono", "accent": "#39ff88"}}
add_sfx_tool {"recipe": "glitch_burst", "at_seconds": 0.35, "gain_db": -18}
add_sfx_tool {"recipe": "typing_burst", "at_seconds": 0.4, "align": "start", "duration": 1.2, "gain_db": -18}
```
`/` breaks a line, so write "MB/s" as "MBPS" or "MB·S". Native fallback (desktop plays it):
`add_kinetic_title_tool {"animation": "scramble"}` (emphasis words decode, the rest pop), or in captions
`kinetic_captions_tool {"animation": "scramble"}`.

## Timing & taste rules
- Decode in 0.4-1 s per line; hold the resolved text ≥ 1 s.
- Mono face (JetBrains Mono) for labels; a display face only for one hero word.
- Labels 1.5-3 % of frame height when they sit next to a hero number (9-30x contrast), 5-8 % when they are the hero.
- At most two decoding lines on screen.

## Sound for it
Soft data chatter under the decode (typing/glitch at -18 to -24 dB), a tick when it resolves; never a whoosh.

## Common mistakes
- Scrambling a sentence of prose (unreadable, gimmicky).
- Using it in a warm/organic piece: it reads as tech.
- Leaving the decode block colour clashing with the grade: set `accent` to the edit's accent.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-scramble-decode.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-scramble-decode.mp4` and its contact sheet. Checked on the sheet: two mono lines decode left to right with the green front block; a '/' inside 'MB/s' broke the line on the first try (fixed: MBPS). Watch judge (absolute, isolated 3-5 s test): **6.9/10** overall, typography 8; its main note: "The animation cuts out instantly the frame the final digit resolves, truncating the viewer's ability to read the completed spec.".
