---
id: held-orbit-or-ascending-reveal
kind: technique
summary: "For the thesis beat of a property film: one 12-18 s orbit or rising drone move, uncut, music building under it."
categories: [real-estate-tour]
tools: [add_clip_to_timeline_tool, set_clip_speed_tool, set_clip_properties_tool, unify_grade_tool, color_grade_clip_tool, add_kinetic_title_tool, fade_clip_tool, set_audio_gain_tool, automate_volume_tool, add_sfx_tool, master_audio_tool]
pace: calm
mood: [aspirational, serene, premium]
aspect: ["16:9", "9:16"]
pairs_with: [accelerating-cut-length-ramp, tighten-then-release-into-held-payoff, sentence-level-interview-subtitles, foley-first-cold-open]
avoid_with: [whip-transition-motion-blur-smear, scale-alternating-shot-rotation]
needs: []
---

# Held orbit or ascending reveal

## What it is

After a run of 2-4 s room shots, one drone orbit, arc or rise is left
uncut for 12-18 s, so the building's geometry or its site (hillside, coast,
skyline) reveals itself while the narrator or a single line states the
idea. The length is the point: the viewer is finally allowed to look.

## Build it in Zenvi

Pick a source move with steady speed and no reversal. Retime it to the
beat length with `set_clip_speed_tool` (1.0-1.5x stays smooth on drone
footage; above 1.6x the parallax starts to look fast-forwarded).

```json
add_clip_to_timeline_tool {"file_id": "<room A, moving>", "position_seconds": 0, "start_seconds": 2, "end_seconds": 4, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<room B, moving>", "position_seconds": 2, "start_seconds": 4, "end_seconds": 6, "track": "1"}
add_clip_to_timeline_tool {"file_id": "<aerial orbit>", "position_seconds": 4, "start_seconds": 2, "end_seconds": 24.5, "track": "1"}
set_clip_properties_tool {"scope": "all", "properties": {"scale": "Crop", "volume": 0}}
set_clip_speed_tool {"timeline_clip_ids": ["<orbit>"], "target_duration_seconds": 15}
unify_grade_tool {"look": "sunlit_cinema", "look_intensity": 0.3}
color_grade_clip_tool {"timeline_clip_ids": ["<room A>", "<room B>"], "temperature": 0.25, "saturation": 1.1}
add_kinetic_title_tool {"text": "<one short thesis line>", "position_seconds": 10.0, "duration_seconds": 4.0, "style": "editorial", "animation": "rise", "emphasis": "none", "text_size": 0.05, "y": 0.8}
fade_clip_tool {"clip_id": "<orbit>", "fade_out_seconds": 1.5}
add_clip_to_timeline_tool {"file_id": "<music bed>", "position_seconds": 0, "start_seconds": 0, "end_seconds": 19, "track": "5"}
set_audio_gain_tool {"clip_ids": ["<bed>"], "gain_db": -4}
automate_volume_tool {"clip_ids": ["<bed>"], "shape": "swell", "start_seconds": 4.0, "end_seconds": 17.5, "db": 5}
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 4.0, "duration": 1.5, "gain_db": -18}
fade_clip_tool {"clip_id": "<bed>", "fade_in_seconds": 0.5, "fade_out_seconds": 2.5}
master_audio_tool {"target_lufs": -16, "true_peak_dbtp": -1.5, "balance": "keep"}
```

With a narrator, place the thesis sentence (from `transcribe_media_tool` /
`get_transcript_tool`) so it ends 2-4 s before the move ends, and duck the
bed under it (`duck_tool {"under": "voice"}`) before the swell.

## Timing & taste rules

- Hold 12-18 s; under 10 s it reads as one more shot, over 20 s it sags.
- The shots before it are 2-4 s and moving (gimbal glides), so the hold
  is a release, not a stall. Static interiors before it make the whole
  piece feel slow (the judge's first note).
- Move speed constant; retime 1.0-1.5x. Start the line at 40-50 % of the
  hold and clear it at least 2 s before the move ends.
- Put the line over sky, lawn or shadow, not over a busy patio or pool;
  serif at 4-5 % frame height, or add a soft dark plate behind it.
- Same grade family inside and out: warm the interiors (temperature
  +0.2 to +0.3) to meet a sunlit exterior.
- End on the move's last steady frame with a 1-1.5 s fade, the bed's
  fade 2-2.5 s and ending on a resolved chord, not mid-phrase.

## Sound for it

Music-led: the bed (-16 to -14 LUFS) swells +4 to +6 dB across the hold
(`swell`, bezier), peaking as the line lands. A soft riser (-18 dB) into
the cut to the aerial helps the change of scale. Under the hold add
outdoor ambience (wind, birds) at -30 to -34 LUFS so the exterior is not
only music. With VO: bed 8-10 LU under the voice during the sentence.

## Common mistakes

- Cutting away halfway because the move "feels long"; that is the beat.
- Retiming to 2x so the drone looks fast-forwarded.
- A thesis line that claims what the picture does not show.
- Low-contrast type over the brightest part of the frame.
- A bed that fades out mid-phrase under the last frame.

## Verified

2026-10-28. 19 s at 1280x720/24: two 2 s Pexels interiors, then a
27.8 s pool-house orbit (2-24.5 s retimed to 15 s, 1.5x), editorial line
at 10 s, bed swell +5 dB. Contact sheet: smooth ~40 degree orbit, no
judder at 1.5x. Judge 3.36/10, then 3.45/10 after warming the interiors,
upgrading the line to editorial serif and lengthening the fades (verdict
unchanged). The judge did not fault the hold itself; it faulted the
static interiors before it, the line's contrast over the patio, and no
riser or ambience, which are now rules above (riser and ambience not
re-rendered). Artifacts:
`~/zenvi-motion/fleet/artifacts/sk4-cinematic-story/techniques/held-orbit-or-ascending-reveal.*`.
