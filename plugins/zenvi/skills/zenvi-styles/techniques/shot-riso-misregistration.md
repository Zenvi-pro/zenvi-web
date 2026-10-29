---
id: shot-riso-misregistration
kind: technique
summary: "When a paper-and-ink film needs one big hit: the title splits into two ink plates, shakes, then snaps into register."
categories: [kinetic-type-motion-design, brand-story-corporate, music-lyric-video, flash-cut-match-cut-edit]
tools: [add_kinetic_title_tool, add_title_tool, set_clip_properties_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [print, tactile, loud]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-keyword-slam, kinetic-quote-card, kcut-hit-fx]
avoid_with: [shot-slam-entrance, shot-attention-bounce]
needs: []
---

# Riso misregistration hit

## What it is
The paper-and-ink twin of an RGB glitch. On impact the headline splits into two single-ink plates (fluorescent pink and blue), thrown 20 px
apart in opposite directions; the plates shake, then snap into register with a hard cut, a stamp pulse, and an "ON REGISTER" seal. Two inks that
multiply into dark purple when aligned. One-shot: one or two per film.

## Build it in Zenvi
1. Paper ground: `add_title_tool {"template":"Solid_Color","text":" ","background_color":"#f3eee2","position_seconds":0,"duration_seconds":4}`; optional texture with `apply_fx_tool` `halftone` (`params`: `cell` 10, `ink` "#3b2a2a", `paper` "#f3eee2") on a still.
2. Plate A (pink) and plate B (blue): the same headline twice, `add_kinetic_title_tool {"text":"PRINT IT LOUD","style":"stack","animation":"slam","emphasis":"none","ink":"#ff4fa3","text_size":0.3,"position_seconds":0.5,"duration_seconds":3}` and again with `"ink":"#1f5fc4"`.
   Overlap shows as the darker mix with a multiply blend on both plates: `set_clip_properties_tool {"timeline_clip_ids":["<plate A>","<plate B>"],"properties":{"composite":"multiply"}}` (check with the contact sheet; Zenvi has no edge-tint or ink-bleed pass, `print-ink-look-fx`).
3. Misregistration: `set_keyframes_tool property=location_x` on plate A: `offset(t) = +A*cos(2*pi*t/18 f)*exp(-t/60 f)`, A=(20,8) px, keyframes every 3-4 f (`linear`) for ~44 f from the slam frame; plate B gets the opposite sign. Sample about 12 points, ending at 11 px, then
   one keyframe pair that hard-cuts both to 0 (`interpolation:"constant"` or two keys 1 frame apart) at frame 72.
4. Register pulse: `scale_x/scale_y` 1.03 to 1.0 over 4 f on both plates at the snap, 1.2 % shudder (10 f) on the slam, and the seal as `add_kinetic_title_tool {"text":"ON REGISTER","animation":"pop","text_size":0.05,"position_seconds":2.5}`.
5. Only the headline splits; background and info bars stay registered.
6. Fallback single-layer look: `apply_fx_tool {"clip_id":"<title>","effects":[{"effect":"chromatic_aberration","amount":0.8}]}` for a screen-glitch version.

## Timing & taste rules
- 4 s. Slam in 8 f `ease_in_cubic`; misregister on the first impact frame (a 2-frame delay reads as two events).
- Offset >= 16 px per plate (32 px total) at 1920 wide; the original +-5 px is invisible. For a 300 px headline 20 px / 40 px. Mix x and y (mostly x, some y), pure horizontal reads as shaking.
- Snap is a hard cut from ~11 px to 0, not an ease: the "snap" is the whole effect. Hold >= 40 f still after.
- Multiply blend = "ink" feel; screen = glow (wrong medium). Complementary hues that make near-black when overlapped; no grey.
- For tight tracking (-0.045 em), check where cross-strokes of neighbouring letters touch and pull one pair 0.01 em apart to avoid a hairline light seam.
- Use this OR the negative-flash hit in a film, never both.

## Sound for it
`impact_slam` on the slam (-6 dB), a dry `static` or `glitch_burst` ticking under the shake, and a stamp-like `impact_thud` (-10 dB) with the seal on the snap.

## Common mistakes
- Splitting the whole frame: reads as a glitch, not print.
- Easing back into register.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/effects/riso-print-hits.md` (Apache-2.0; see ../NOTICE).
