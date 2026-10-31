---
id: cin-tx-micro-tick-ui-sound
kind: technique
summary: "When prompts type or UI builds under music: tiny dry ticks sit under the bed and vanish once the drums enter."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [detect_music_structure_tool, add_sfx_tool, set_track_role_tool, analyze_mix_tool]
pace: calm
mood: [tactile, quiet, precise]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [prompt-bar-typing-hero, cin-cl-accent-on-newest, kinetic-typewriter]
avoid_with: [voice-over-bed-mix-balance]
needs: []
drawn: cinetic
---

# Micro-tick UI sound

cinetic `tx-micro-tick-ui-sound` · Texture and finish · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

(Sound) Typing and UI changes get tiny, dry ticks at or under the music, and once the drums run the UI goes silent, so the picture feels tactile without a loud keyboard sample.

Use when: Typed prompts, word-by-word builds, cold opens before the beat drops, any UI moment that wants touch without an effect announcing itself.

## Build it in Zenvi

1. Find where the drums enter: `detect_music_structure_tool {"clip_id": "<music>", "add_markers": true}`. UI ticks stop at that marker.
2. One tick per word as it becomes legible, not per letter, each a little different: `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 1.20, "gain_db": -27, "seed": 1}`, `{"recipe": "keyboard_key", "at_seconds": 1.52, "gain_db": -26, "seed": 2}`, ... at least 60 ms (3.6 f) apart, with plus/minus 1 dB gain jitter.
3. UI appearances get `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 2.4, "gain_db": -28}`; a run of UI ticks climbs about 1 dB per event into the payoff.
4. File the ticks as sfx and check the level: `set_track_role_tool {"track": "<sfx_track>", "role": "sfx"}`, then `analyze_mix_tool {"detail": "sfx"}`: ticks peak 15-20 dB under the full bed and never brighter than the music above 2 kHz.
5. Once the drums run, leave the UI silent (the hats carry the typing).

## Timing & taste rules

- cinetic's timing (60 fps): Ticks 2-6 ms long, at least 60 ms (3.6 f (0.06 s)) apart, sigma 3.5 ms timing jitter and +-1 dB gain jitter; peaks -23 to -36 dBFS, at or under the bed's RMS; zero UI sounds once the drums enter.
- Weight about 0.2-0.35: 12-18 dB under the landing hit; peaks -23 to -36 dBFS, at or under the bed's RMS.
- Ticks 2-6 ms long, at least 60 ms (3.6 f) apart, about 3.5 ms timing jitter and plus/minus 1 dB gain jitter.
- One tick per word on fast typing; a run of UI ticks climbs about 1 dB per event.
- Zero UI sounds once the drums enter.

## Sound for it

This entry is the sound: ticks only on cause (a legible word, a UI appearance), dry, under the bed.

## Common mistakes

- Placing ticks under voice-over syllables or inside a dense drum section.
- A loud keyboard sample.
- A film whose idea is silent UI over a beat bed throughout.
- Avoid when: Under voiceover syllables; inside a dense drum section; loud keyboard samples; a film whose idea is silent UI over a beat bed throughout.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-tx-micro-tick-ui-sound.mp4` (1280x720p60, flat card with a typewriter editorial title (1.0-4.0 s), a 120 BPM tone bed, five keyboard_key ticks from 1.2 s every 0.32 s with seeds 1-5 and gains -27 to -24 dB, ui_tap at 2.4 s at -28 dB, ticks filed as the sfx stem with set_track_role_tool and checked with analyze_mix_tool): the ticks land one per word at the stated gains, the role is accepted, and analyze_mix_tool reports the sfx true peak at -16.9 dBFS in a -26.7 LUFS mix; it also flags that the two title events at 1.00 s and 1.37 s have no cue within a frame (hit coverage 0); the tick sounds themselves are audio only, judged on picture it is a plain title; watch judge 2.7/10.

Found when rendering it (apply before building):

- Step 1: detect_music_structure_tool {"clip_id": "<music>", "add_markers": true} works; on a steady tone it reports one verse section and no drop, so the marker is only useful with real music.
- Step 4: analyze_mix_tool detail is compact | full (sfx is refused); use {"detail": "full"}. set_track_role_tool {"track": "SFX", "role": "sfx"} works with the track label as it comes (the ticks sit on the SFX tracks add_sfx_tool creates, SFX and SFX 2; set the role on each).
- Step 2: ticks placed 0.32 s apart ended up on two SFX tracks (SFX and SFX 2) because the receipts show overlapping sounds; set the sfx role on both tracks. add_sfx_tool keyboard_key accepts seed and gain_db (-24 to -27 accepted).

Translated from cinetic's technique library (`tx-micro-tick-ui-sound`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
