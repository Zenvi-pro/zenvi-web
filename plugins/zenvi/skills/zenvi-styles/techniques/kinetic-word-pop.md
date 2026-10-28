---
id: kinetic-word-pop
kind: technique
summary: "When a line must read word by word over footage: each word pops in on its own beat with a small overshoot."
categories: [talking-head-captions, podcast-clip-vertical, ugc-ad-testimonial, kids-education, saas-app-launch]
tools: [add_kinetic_title_tool, kinetic_captions_tool, add_sfx_tool]
pace: fast
mood: [energetic, playful, direct]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [kinetic-emphasis-scale, kinetic-vo-captions, kinetic-keyword-slam]
avoid_with: [kinetic-typewriter, kinetic-scramble-decode, kinetic-letter-cascade]
needs: []
---

# Word-by-word pop

## What it is
Each word of a short line (2-6 words) scales in from half size with a small overshoot, one after the other, so the line
is read at the speed it is said. Shines on hooks, creator talking heads and kids/UGC pieces.

## Build it in Zenvi
A title (no voice to follow):
```json
add_kinetic_title_tool {"text": "stop chasing the deadline", "style": "creator", "animation": "pop", "emphasis": "deadline",
  "position_seconds": 0.4, "duration_seconds": 2.2, "stagger_seconds": 0.18, "avoid": [{"x": 0.62, "y": 0.4, "w": 0.3, "h": 0.6}]}
add_sfx_tool {"recipe": "pop", "at_seconds": 1.0}
```
Over speech: `kinetic_captions_tool {"style": "creator", "animation": "pop"}` (words timed to the voice, see
kinetic-vo-captions). `avoid` is the speaker's face/body box (0-1, centre and size); without it the tool keeps off the
subject matte when the clip has one.

## Timing & taste rules
- Stagger 0.12-0.2 s per word (≈ speech rate 140-170 wpm); never all at once unless it is a slam.
- Overshoot stays ≤ 115 % (the pop preset's); bouncier reads as kids' TV.
- Hold the finished line ≥ 0.4 s per short word after the last word lands; exit by cut, not fade.
- One pop line per scene; the next line replaces it on a cut or a beat.
- Second layer of motion (families/kinetic.md rule 2): while the type holds, the picture keeps moving — push the
  footage or backdrop 1.0 → 1.06 over the shot with `set_keyframes_tool` on that clip (not on the title clips).

## Sound for it
A pop or soft tap on the emphasis word only (CRAFT: card pop -16 to -20 dB); connectors stay dry. Vary `seed` between
repeats so no two pops are the same sample within 3 s.

## Common mistakes
- A pop on every word (fatigue, and the voice is masked).
- Text over the face: the line must sit in the shot's negative space (`avoid`).
- Mixing pop with letter-level motion in the same scene.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-word-pop.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-word-pop.mp4` and its contact sheet. Checked on the sheet: words pop in order with the stagger, connectors small and white, DEADLINE / IDEA about 6x in red condensed caps, kept beside the head (avoid box); the subject walks into the hero word once (static avoid box on a moving speaker). Watch judge (absolute, isolated 3-5 s test): **4.1/10** overall, typography 6; its main note: "The video is completely silent with zero audio track, voiceover, or SFX.".
