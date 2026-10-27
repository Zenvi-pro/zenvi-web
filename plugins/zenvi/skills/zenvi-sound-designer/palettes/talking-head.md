# Talking head / kinetic captions

Design: `auto_sound_design_tool` `{"genre": "talking_head", "intensity": "subtle"}`.
Score / master: `"genre": "talking_head"`.

- Voice first: dialog-gated about -15 LUFS, the bed 10 dB under it (8-12)
  while speaking, ducked with 40 ms attack and 400 ms release; the bed
  swells +2 dB between lines.
- Cues only on emphasis words, B-roll inserts and floating cards: 0.3-1.2
  cues/s. A soft thump or pop one frame late on the big word; a whoosh on an
  insert, never over a word.
- Signature: silence (bed dipped) right before the punchline.
- Avoid: cues on connector words, anything bright (1-4 kHz) under speech,
  F2 (SFX on words) failing: move those cues into the pauses.
