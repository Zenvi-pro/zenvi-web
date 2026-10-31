---
id: cin-tx-locked-mosaic
kind: technique
summary: "When a gated feature builds desire: card art shows pixelated, grey and dark with a lock, then snaps clean on unlock."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [duplicate_clips_tool, color_grade_clip_tool, apply_fx_tool, add_emoji_tool, add_type_block_tool, split_clip_tool, set_keyframes_tool, add_title_tool, add_sfx_tool]
pace: medium
mood: [teasing, gated, premium]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-duotone-until-featured, shot-card-flip-reveal, shot-control-state-change]
avoid_with: [cin-tx-scanline-transmute]
needs: [pixelate-mosaic-fx]
drawn: cinetic
---

# Locked-state mosaic

cinetic `tx-locked-mosaic` · Texture and finish · signature · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Withheld content shows as pixelated, desaturated, darkened art with a lock glyph and thin light lines sliding across it, until an unlock snaps it to clean full-tone art.

Use when: Premium, gated or upcoming features; a reveal sequence where concealment builds desire; access or unlock stories.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same locked copy, pixelate and lock as the full build.
2. Light strokes as crisp 1.5-2 px lines at 30-60 % white (`add_type_block_tool {"block": "write_on", ..., "stroke_width": 2, "ink": "#ffffff"}` kept at alpha 0.3-0.6), no soft screen-blended ribbons.
3. Unlock brightness overshoot stays inside the card: no burst, no rays past its edge; use the same 12 f / 4 f / 10 f timing.

**Full look** (relies on glow: only when the person's brand supplies that look):

1. Clean art clip on track 2, and a locked copy above it: `duplicate_clips_tool {"timeline_clip_ids": ["<art>"], "to_track": "3"}`.
2. Locked look on the copy: `color_grade_clip_tool {"timeline_clip_id": "<locked>", "saturation": -1, "exposure": -1.7}` and chunky pixels: `apply_fx_tool {"clip_id": "<locked>", "effects": [{"effect": "dither", "amount": 1, "params": {"colors": 32, "pixel": 12, "pattern": "bayer", "monochrome": false}}]}`.
3. Lock glyph at the centre: `add_emoji_tool {"emoji": "lock", "position_seconds": 0, "duration_seconds": 1.6, "screen_position": "center", "size": 0.12}`. Slow light strokes, 2-3 thin curves drifting 2-4 px per frame, as thin lines: `add_type_block_tool {"block": "write_on", "paths": ["M 0 540 Q 480 480 960 540 T 1920 540"], "view_box": "0 0 1920 1080", "stroke_width": 2, "ink": "#ffffff", "position_seconds": 0, "duration_seconds": 0.6}` with `location_x` keyframes across the locked state.
4. Unlock at 1.5 s: strokes brighten to 60 % over the 12 f (0.2 s) before; the locked copy dips (`alpha` 1 to 0.6 over 4 f = 0.07 s) then on the next frame cut to clean art by trimming the locked copy off (`split_clip_tool {"clip_id": "<locked>", "at_seconds": 1.57, "keep": "left"}`). The clean art enters at brightness 1.12 easing to 1.0 over 10 f (0.17 s): `set_keyframes_tool` is not needed; add a short white `add_title_tool {"background_color": "#ffffff30", "position_seconds": 1.57, "duration_seconds": 0.17, "fade_out_seconds": 0.17}`.
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 1.57, "gain_db": -12}`; a run of cards unlocks every 30-45 f (0.5-0.75 s) apart, each about 25 % quicker.

Fallback: Zenvi has no pure pixelate filter; the dither FX at pixel size 12 gives the chunky blocks (blocks about 2.5 % of the card width) but it is a dither, not an upscaled thumbnail. Do not use it on text; pixelated text reads as broken.

## Timing & taste rules

- cinetic's timing (60 fps): Locked state 54-108 f (1.80 s) (the strokes keep moving, so nothing is static); unlock = 12 f (0.20 s) brighten, 4 f (0.07 s) dip, swap, 10 f (0.17 s) settle; repeated unlocks 30-45 f (0.75 s) apart, each ~25% quicker.
- Locked state 54-108 f (0.9-1.8 s); the strokes keep moving so nothing is static, 2-4 px per frame.
- Unlock = 12 f (0.2 s) brighten, 4 f (0.07 s) dip from brightness 0.3 to 0.18, swap, 10 f (0.17 s) settle with 1.12 easing to 1.0.
- Repeated unlocks 30-45 f (0.5-0.75 s) apart, each about 25 % quicker.
- Lock glyph a 32-40 px line icon, no caption.
- One reveal device per act.

## Sound for it

A small `pop` or `ui_tap` on the swap frame, a faint `toggle` for the shackle; repeated unlocks each get their own, quicker.

## Common mistakes

- Products with nothing gated.
- Text content as the withheld art.
- More than one reveal device in the same act, or a burst past the card's edge on a brand that bans glows.
- Avoid when: Products with nothing gated; text content (pixelated text reads as broken); more than one reveal device in the same act.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-locked-mosaic`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
