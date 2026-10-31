---
id: action-per-cut-micro-demo-with-live-foley
kind: technique
summary: "When a product demo must feel real: 8-10 cuts in 12-14 s, one physical action each, its foley on every cut, no music."
categories: [ugc-ad-testimonial]
tools: [search_clip_scenes_tool, split_clip_tool, trim_clips_tool, add_clip_to_timeline_tool, spot_sound_tool, add_sfx_tool, search_sound_library_tool, master_audio_tool]
pace: fast
mood: [tactile, honest, satisfying]
aspect: ["9:16", "4:5", "1:1"]
pairs_with: [cuts-on-audio-transients, circular-problem-to-proof-bookend, cut-on-action]
avoid_with: [voice-over-bed-mix-balance, accelerating-cut-length-ramp]
needs: [action-foley-spotter]
---

# Action-per-cut micro-demo with live foley

## What it is
The UGC demo: tear, pour, cap, shake, apply, sip; one action per shot of
1.1-1.6 s, ten cuts in 14 s, and the sound of each action at the cut, level
with the picture. No music bed, so the foley is the rhythm.

## Build it in Zenvi
1. Find the actions: `search_clip_scenes_tool {"query": "dropper bottle squeeze"}`
   etc.; `split_clip_tool` / `trim_clips_tool` so each shot starts on the action.
2. Place them butted (`add_clip_to_timeline_tool` per shot).
3. Keep the recorded sound. Silent footage: one foley per action at the cut,
   by material: `add_sfx_tool {"recipe": "pop" | "paper" | "cloth" | "swish_airy" | "ui_tap",
   "at_seconds": <cut + 0.05>, "gain_db": -10, "seed": <n>}`, or a matching
   library sound (`search_sound_library_tool {"query": "water pour glass"}`); a
   generic pop on a pour reads cartoonish (the judge's note).
4. `spot_sound_tool` lists cuts with no cue; fill them. Picture actions inside
   a shot (not at cuts) are not spotted (`action-foley-spotter`).
5. `master_audio_tool {"preset": "social"}`: foley-only mixes come out quiet.

## Timing & taste rules
- 1.1-1.6 s per shot; 8-10 cuts per 14 s; every shot a new action or object.
- Close and extreme close dominate (55 %); one wide at most.
- The sound lands within 0.3 s of the cut, ideally on the visible contact.

## Sound for it
The sounds are the music: varied material foley at about -10 dB peaks,
nothing else; a voice line on top is fine.

## Common mistakes
- A bed over it (masks the tactile rhythm).
- One sample for every action.
- Low-quality or mismatched shots in the run (the judge flagged a pixelated
  splash shot).

## Verified
2026-10-28: 11.1 s test, eight stock skincare actions (dropper, tea pour,
water pour, cream, wash, tray) with material foley per cut, no music, mastered
to -14 LUFS. Contact sheet: one action per shot. Watch judge overall 4.18; fixes:
a matching pour sound, a cleaner splash shot, an ending.
