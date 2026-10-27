# Hype (sport, cars, fashion, trailers)

Design: `auto_sound_design_tool` `{"genre": "hype", "intensity": "hype"}`
(pass build_reel_tool's `beats` and `climax_seconds` when you have them).
Score / master: `"genre": "hype"`.

- Music drives it: a trap / phonk / EDM bed at full level, the drop on the
  hero reveal. 1.5-3.5 cues/s; most cuts get a light hit or a short whoosh,
  alternating, never the same sample twice in a row.
- Hero hits: sub + harmonic + transient + bright tail (plate 1-1.8 s on
  heroes only). Hero momentary about -9 LUFS, peaks -1 dBTP.
- Signature: riser 2-4 bars → 200 ms suck-out (-18 dB) → sub hit + tail on
  the drop; the bed dips 10 dB for 100-150 ms before each hero hit
  (`automate_volume_tool` `{"role": "music", "shape": "pre_hit_duck"}` when the
  design did not); a tape-stop or reverse swell at a section end.
- Avoid: a whoosh on every cut, sub without harmonics, reverb on every layer,
  two heroes closer than 250 ms (demote one to a sweetener, -6 dB).
