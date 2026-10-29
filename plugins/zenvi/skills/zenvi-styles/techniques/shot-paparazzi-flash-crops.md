---
id: shot-paparazzi-flash-crops
kind: technique
summary: "When one moment must be crowned like a press photo: three white flashes hard-cut one frozen frame into tighter crops."
categories: [sports-hype-edit, flash-cut-match-cut-edit, movie-game-trailer, product-launch-film, gaming-montage]
tools: [add_clip_to_timeline_tool, save_frame_image_tool, set_keyframes_tool, apply_motion_transition_tool, add_sfx_tool]
pace: fast
mood: [hype, ceremonial, punchy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-silence-before-hit, cinematic-push-in, kcut-hit-fx]
avoid_with: [shot-glitch-tear-cut, cinematic-whip-cut, shot-hidden-cut-masks]
needs: []
---

# Paparazzi flash crops

## What it is
The cut is the drum: live footage, then three camera-flash hard cuts into the same frozen frame at 1.0x, 1.6x and 2.8x,
each with a shutter click, ending on a long hold on the tightest crop. Shines on an award, a key number or a name that
is being crowned; once per film.

## Build it in Zenvi
1. Live lead-in, about 1 s (the freeze must come out of motion):
   `add_clip_to_timeline_tool {"file_id": "<F>", "start_seconds": 4, "duration_seconds": 1.0, "position_seconds": 0, "track": "1"}`
2. Freeze the last live frame: `save_frame_image_tool {"time": 0.95, "file_path": "<dir>/still.png", "overwrite": true}`,
   then import the PNG (CLI: `zenvi import`). A photo of the subject works the same. (Hosts that cannot import a PNG:
   retime a 2-frame window with `set_clip_speed_tool target_duration_seconds` — not tried.)
3. Three clips of the still, back to back on the same track, cuts at 1.0 / 1.73 / 2.33 s (22 f then 18 f), the last
   2.3 s: `add_clip_to_timeline_tool {"file_id": "<S>", "position_seconds": 1.0, "duration_seconds": 0.7333, "track": "1"}` etc.
4. Crops by keyframes on each still clip: `set_keyframes_tool {"timeline_clip_id": "<C>", "property": "scale_x",
   "points": [{"seconds": 0, "value": 1.648}, {"seconds": 0.2, "value": 1.6, "ease": "ease_out"}]}` (same for `scale_y`; the
   first value is zoom x 1.03 = the shutter settle). Aim the crop with `location_x` / `location_y` (constant two-point
   curve): shift = min(0.22 x zoom, (zoom - 1) / 2) for a subject left of centre; 0 for the 1.0x crop.
5. A 3-frame white flash on each cut: `apply_motion_transition_tool {"preset": "flash_white", "clip1_id": "<prev>",
   "clip2_id": "<next>", "duration": 0.1}` (cuts 1-3), and `add_sfx_tool {"recipe": "camera_shutter", "at_seconds": 1.0,
   "gain_db": -10, "seed": 1}` per cut (new seed each).

## Timing & taste rules
- Cut points 30 / 52 / 70 f (1.0 / 1.73 / 2.33 s): gaps tighten 22 f then 18 f; never even.
- Flash 0.95 to 0 over 4 f (Zenvi: 3 f, 0.1 s); longer than 6 f it turns into a soft glow dissolve.
- Settle after each cut: scale x1.03 back to 1 in 6 f ease-out.
- Crops 1.0 / 1.6 / 2.8, always getting closer; never reorder; keep crop edges off half a line of text.
- Final hold 70 f (2.3 s) with at most a 1 to 1.015 push; a frozen photo gets no in-picture motion.
- The cuts are real hard cuts: a 2-frame cross-dissolve kills the beat.

## Sound for it
`camera_shutter` on every flash (-10 dB, new `seed` each); no music bed under the three cuts or let the drum land on them;
let the hold ring with a `tail_bloom` at -22 dB or silence. Without the clicks it just looks like a glitching screen.

## Common mistakes
- A frozen lead-in (the flashes then read as nothing changing): the 30 f before must be live footage.
- Three unrelated pictures instead of three crops of one frame: the viewer loses who is being photographed.
- Using it twice in a film: the first one gets stale.
- A hold after the third flash shorter than twice the usual one: the hit has no room to land.
- Cuts not on audio beats.

## Verified
2026-10-29, CLI on bench footage (`pexels_5528003`): scripts/shot-paparazzi-flash-crops.sh → shots/shot-paparazzi-flash-crops.mp4 (local only). Checked on the sheet: 1 s live, then the still at full frame, a 1.6x and a 2.8x crop both aimed at the face (the first try shifted the 1.0x crop and showed black bars; fixed by capping the shift at (zoom - 1) / 2), flashes and clicks on three cuts. Watch judge (absolute): **5.55/10**; main note: "the selected freeze frame catches the subject in an unflattering, awkward side-profile glance ... the hold at the end is completely static".

Adapted from video-shotcraft card `shots/rhythm/beat-cut-moves.md` (Apache-2.0; see ../NOTICE).
