# Video essay / documentary

Design: `auto_sound_design_tool` `{"genre": "video_essay"}` (or
`"documentary"` for a slower opening), `"intensity": "subtle"` when the VO
runs almost wall to wall.
Score / master: `"genre": "video_essay"`.

- Voice is king: about -15 LUFS dialog-gated, the underscore 8-10 dB under it
  while speaking (`duck_tool` `{"under": "voice", "target_vbr_db": 10}` if the
  receipt shows B1 under 8).
- Few cues, 0.5-1.5/s: paper or photo foley on collage moves, soft whooshes
  on chapter cards, a stinger on a reveal, a low drone under tension.
- Signature: a 200 ms suck-out before the key line, then let it land in
  silence; the bed swells between lines.
- Avoid: hype hits, anything in 1-4 kHz under the VO, cues inside words.
