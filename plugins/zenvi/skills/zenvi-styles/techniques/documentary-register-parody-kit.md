---
id: documentary-register-parody-kit
kind: technique
summary: "When the joke is the genre: hushed nature-doc narration, ambience bed, then a trail-cam HUD with a running clock."
categories: [fitness-lifestyle]
tools: [generate_tts_and_add_to_timeline_tool, search_sound_library_tool, add_timer_tool, add_title_tool, apply_look_tool, color_grade_clip_tool, add_vignette_tool, set_track_role_tool]
pace: calm
mood: [deadpan, comic, observational]
aspect: ["9:16", "16:9"]
pairs_with: [blackout-and-dead-silence-pause, voice-over-bed-mix-balance, whip-transition-motion-blur-smear]
avoid_with: [karaoke-word-highlight-captions, vo-keyed-emphasis-stack, sentence-split-rapid-hook]
needs: []
---

# Documentary-register parody kit

## What it is
Shoot a gym, a kitchen or an office like a wildlife film: hushed narrator,
long-lens observation, birds and wind, then an "evidence" beat through a
trail camera (desaturated, vignetted, mono HUD with a running clock). The
mismatch between register and subject is the comedy.

## Build it in Zenvi
1. Narration: `generate_tts_and_add_to_timeline_tool {"text": "Here, in the
   early hours, the gym regular approaches his territory.", "voice": "fable",
   "speed": 0.9}`; short clauses, long pauses. A real whispered read is better:
   TTS cannot whisper convincingly.
2. Ambience: `search_sound_library_tool` (birds, wind, room tone) on an
   ambience track, `set_track_role_tool` ambience, -30 to -38 LUFS.
3. Trail-cam beat, on its shots only:
   - `apply_look_tool {"timeline_clip_id": "<timeline_clip_id>", "look_id": "gloomy", "stack_grain": true,
     "grain_preset": "16mm_classic"}` and `add_vignette_tool {"amount": 0.5}`
   - `add_timer_tool {"mode": "clock", "start_at_seconds": 20820, "format": "hh:mm:ss",
     "font": "Menlo", "text_size": 0.05, "screen_position": "bottom_right",
     "background": false, "position_seconds": <beat start>, "duration_seconds": <beat>}`
   - `add_title_tool {"text": "CAM 02  ●REC", "font": "Menlo", "font_scale": 0.9,
     "screen_position": "bottom", "text_color": "#e8e8e8", ...}`
4. Observation shots: long lens through foreground (plants, door frames) if
   the footage has it; static, held 3-6 s.

## Timing & taste rules
- Narration at about 105-130 wpm with 0.5-1 s pauses; never louder than -16 LUFS.
- HUD mono at about 3.5 % frame height in the bottom 8 % band (0.05 short side
  = readable; 0.035 was too small in the test).
- The HUD only on the evidence beat, not the whole piece.
- Hold the deadpan: no captions popping, no whooshes.

## Sound for it
Ambience bed continuous; narration dry and close; one diegetic sound (a
plate clank, a door) lifted above the bed at the payoff.

## Common mistakes
- Grading the whole piece trail-cam: it only works as a contrast.
- A dark first shot (the test's first version opened on an almost black gym).
- HUD text too small to read on a phone.

## Verified
2026-10-28: 5.5 s gym test (stock), macOS "Whisper" voice as a placeholder,
gloomy + 16 mm grain + vignette, Menlo clock and CAM label. First render's HUD
was 1.5 % tall and the opening shot black; fixed to the sizes above. Watch judge
overall 3.0: the synthetic whisper sounds robotic (use a real read) and the HUD
wants surveillance texture (scan lines would need `crt-scanline-fx`).
