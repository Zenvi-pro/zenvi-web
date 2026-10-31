---
id: blackout-and-dead-silence-pause
kind: technique
summary: "When the peak needs a held breath: 0.3-1.5 s of black and near-silence, then a slam, a line or dense foley."
categories: [fitness-lifestyle, flash-cut-match-cut-edit, gaming-montage, movie-game-trailer]
tools: [automate_volume_tool, add_sfx_tool, add_marker_tool, move_clips_tool, split_clip_tool, add_title_tool]
pace: fast
mood: [dramatic, comic, tense]
aspect: ["9:16", "16:9", "4:5", "1:1"]
pairs_with: [accelerating-cut-length-ramp, documentary-register-parody-kit, hard-cut-chapter-title-cards]
avoid_with: [pause-free-tight-cut, voice-over-bed-mix-balance]
needs: []
---

# Blackout and dead-silence pause

## What it is
Everything stops: picture to black (or a frozen frame), music and ambience
cut, for 0.3-1.5 s. Then the hit: a slam, a line of dialogue, a stampede of
foley. The silence is the cue; it works once per piece, at the peak.

## Build it in Zenvi
1. Leave a gap on the picture track (or `move_clips_tool` the rest later by
   the gap) at the peak; `add_marker_tool` at the gap start.
2. Kill the bed for exactly the gap:
   ```json
   automate_volume_tool {"role": "music", "shape": "dip", "start_seconds": <gap>,
     "end_seconds": <gap + 1.2>, "db": -60, "fade_ms": 20}
   ```
   (`shape` is required; without it the call is refused.) Ambience the same.
3. Before the gap: a snap or stick-break `add_sfx_tool` or let the last action
   land; after it: `add_sfx_tool {"recipe": "impact_slam", "at_seconds": <gap end>,
   "gain_db": -8}` and the next shot or a title (`add_title_tool`) exactly there.
4. Music returns on the hit, or not at all (a hard stop also works).

## Timing & taste rules
- 0.3 s (comedy snap) to 1.5 s (trailer beat); 4+ frames of real silence, in
  the last 15 % of a comedy or hype piece.
- The cut into black on an action peak (a punch landing, a door slam), not
  mid-movement (the judge: "abrupt and unmotivated" when it cut mid-move).
- What comes after must be new: a new shot, a line, a louder world; never the
  same shot again (the test reused a shot and the judge called it a loop).

## Sound for it
True silence (-60 dB) on everything; the hit after at hero level (peaks -1 to
-3 dBTP), with a sub layer for trailers.

## Common mistakes
- Black with music still playing (the refused automation in the first test).
- Two blackouts in one piece.
- A gap shorter than 8 frames: reads as a glitch.

## Verified
2026-10-28: 6.7 s boxing test, four 0.8-1 s shots with punches, a 1.2 s black
gap with the house bed dipped to -60 dB, a slam into the last shot. First run:
the automation was refused (no `shape`), the black played over music. Watch
judge overall 3.27 after the fix; notes: motivate the cut into black on an
action peak and land on new footage.
