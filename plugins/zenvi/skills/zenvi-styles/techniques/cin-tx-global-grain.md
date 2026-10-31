---
id: cin-tx-global-grain
kind: technique
summary: "When flat colour fields or soft ramps look plastic: one fine film grain at a single strength over the whole film."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [apply_look_preset_tool, apply_fx_tool, analyze_frame_colors_tool]
pace: calm
mood: [tactile, filmic, even]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-living-stage, cin-cl-one-hue-light-ramp, cinematic-film-emulation]
avoid_with: [cin-tx-ramp-masked-stipple]
needs: []
drawn: cinetic
---

# Global frame-keyed grain

cinetic `tx-global-grain` · Texture and finish · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A fine, even grain sits over the whole film at one strength, breaking banding in soft ramps and blurred plates and giving flat colour fields a tactile surface.

Use when: Films with large flat or saturated colour fields, soft lighting ramps, blurred photo plates, or a tactile, filmic brand.

## Build it in Zenvi

1. Apply one grain look to every clip, once, at the end of the edit: `apply_look_preset_tool {"look": "film_grain_35mm_fine", "scope": "all"}`.
2. Use the same look on every scene, never a different strength per scene. If a flat field still bands after the grain, re-render that field with a light dither (`apply_fx_tool {"clip_id": "<field_clip>", "effects": [{"effect": "dither", "amount": 0.1, "params": {"colors": 32, "pixel": 1}}]}`) rather than raising the grain.
3. Verify on a flat mid-grey frame with `analyze_frame_colors_tool {"timeline_clip_id": "<clip>", "time": 1.0}`: the noise should be about 1.5-2 code levels.

Fallback: Zenvi's grain looks are the preset strengths, not a measured 1.5-2 % layer on a titles-only stage; pick the finest (35 mm fine) and check a flat frame. Titles and motion blocks over a graded plate are grained as part of the clips they sit on if you apply it to all clips.

## Timing & taste rules

- cinetic's timing (60 fps): New tile every 2 f (0.03 s); constant strength (sigma ~1-2.3 code levels) for the whole film; no fades and no per-scene changes.
- Grain sigma about 1-2.3 code levels (a 1.5-2 % layer), constant from first frame to last.
- A new grain pattern every 2 f (0.033 s at 60 fps).
- No fades and no per-scene changes of strength.
- Grain does not replace baked dither: soft gradients still ship as dithered stills.

## Sound for it

None.

## Common mistakes

- Crisp, clinical UI films where any texture reads as dirt.
- Changing the strength between scenes.
- Using grain to fix banding that a dithered ramp should solve.
- Avoid when: Crisp, clinical UI films where any texture reads as dirt; when the strength would have to change between scenes; as a fix for banding that dithered PNGs should solve.

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-tx-global-grain.mp4` (1280x720p60, two test clips (flat dark card, test pattern) with apply_look_preset_tool film_grain_35mm_fine scope all, then an apply_fx dither on the flat card; flat-patch noise measured on the render with ffmpeg crop + pixel std): grain alone gave a std of about 1.0 code level on the flat card at 1280x720 (the target is 1.5-2, so 35mm_fine runs a little under it), and after the dither bake the same patch measured 0.35, so the grain nearly disappears when apply_fx dither colors 32 is baked on a clip that already has the look; watch judge 1/10.

Found when rendering it (apply before building):

- Step 1: apply_look_preset_tool {"look": "film_grain_35mm_fine", "scope": "all"} works as written (applied on 2 clips, effect FilmGrain); other grains are film_grain_16mm_classic, 35mm_classic, 35mm_gritty, high_iso and super_8.
- Step 2: apply_fx dither with colors 32 on a clip that already carries the grain look cut the measured noise on a flat patch from about 1.0 to 0.35 code levels (get_clip_effects_tool still lists FilmGrain); do the dither bake only where banding shows, and measure the patch again, or use a gritter grain look afterwards.
- Step 3: analyze_frame_colors_tool does not measure noise (it reports luma percentiles, cast and saturation of the source frame); measure the render instead: ffmpeg -ss 1 -i out.mp4 -frames:v 1 -vf crop=200:200:100:100,format=gray -f rawvideo - and take the pixel standard deviation (about 1.0 for 35mm_fine here, below the 1.5-2 target; the stronger grains by name were not measured).

Translated from cinetic's technique library (`tx-global-grain`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
