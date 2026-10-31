---
id: cin-cl-light-swell-bridge
kind: technique
summary: "When a dark section releases into the hero card: light swells to near white, cuts on the peak, then exhales to dark."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [add_title_tool, add_shape_mask_tool, add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [cathartic, luminous, dramatic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cinematic-silence-before-hit, kcut-flood-climax, withheld-music-cold-drop]
avoid_with: [cin-cl-inversion-card, cin-cl-rising-wash-carrier]
needs: []
drawn: cinetic
---

# Light swell bridge into the hero

cinetic `cl-light-swell-bridge` · Colour and light · signature · energy high · formats launch, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Light swells around a small panel until the frame is bright, the film cuts on the brightest frame to the hero card sitting in the same light, and that light slowly exhales back to dark.

Use when: Releasing a dark section into the hero card or title: the biggest reveal in a dark film.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same swell, but four hard-edged concentric discs in tonal steps of one hue (stage, then 15 %, 35 %, 60 % lightness toward the accent), each expanding on a 2 f (0.03 s) stagger: for each disc `add_title_tool {"text": " ", "background_color": "<step_n>", "position_seconds": 4.0, "duration_seconds": 0.47, "track": "<2+n>"}` with `add_shape_mask_tool {"clip_ids": ["<disc_n>"], "shape": "ellipse", "width": 1.6, "height": 1.6, "feather": 0, "keyframes": [{"seconds": 4.0, "grow": -0.9}, {"seconds": 4.47, "grow": 0}]}` (start each 0.03 s later).
2. Cut, exhale and sound as in the full build: 28 f swell, cut on the downbeat, 86 f exhale on ease_in_out_sine.

**Full look** (relies on glow, gradient: only when the person's brand supplies that look):

1. Shot A, the panel on dark: the small UI panel on track 1 (e.g. a `glass_cards` block). Swell the light on a track above: `add_title_tool {"text": " ", "background_color": "<light_tint>", "position_seconds": 4.0, "duration_seconds": 0.47, "track": "2"}` plus `add_shape_mask_tool {"clip_ids": ["<swell>"], "shape": "ellipse", "x": 0.5, "y": 0.5, "width": 1.6, "height": 1.6, "feather": 0.6, "keyframes": [{"seconds": 4.0, "grow": -0.9}, {"seconds": 4.47, "grow": 0}]}` (28 f = 0.47 s, linear, mean luma from about 15 to about 78).
2. Cut on the downbeat at the peak (4.47 s). Shot B opens on the same light with the hero already in place: `add_kinetic_title_tool {"text": "Meet Zenvi", "style": "editorial", "animation": "fade", "ink": "#101114", "background": "<light_tint>", "position_seconds": 4.47, "duration_seconds": 2.5}`.
3. Exhale 86 f (1.43 s) back to dark: `add_title_tool {"text": " ", "background_color": "#0b0c0f", "position_seconds": 4.47, "duration_seconds": 1.43, "track": "3"}` with `set_keyframes_tool {"timeline_clip_id": "<dark_veil>", "property": "alpha", "points": [{"seconds": 4.47, "value": 0}, {"seconds": 5.9, "value": 1, "ease": "ease_in_out_sine"}]}` (luma from about 112 to 43). Never exhale on an expo-out.
4. `add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 4.0, "duration": 0.47, "gain_db": -12}`, `{"recipe": "impact_boom", "at_seconds": 4.47, "gain_db": -8}`.

## Timing & taste rules

- cinetic's timing (60 fps): The swell takes 28 f (0.47 s) on linear. Cut at the peak, on a downbeat. The exhale takes 86 f (1.43 s) on ease_in_out_sine (a fade-out never runs on an expo-out).
- Swell 28 f (0.47 s, ease linear), radii growing 12-25 px per frame, so frame luma climbs about 2.25 levels per frame.
- Cut at the peak on a downbeat; put the cut on an act boundary so it stays crisp.
- Exhale 86 f (1.43 s) on a smooth ease_in_out_sine, handing off to the next dark shot.
- Once per film, for the biggest reveal only.

## Sound for it

Riser under the swell (peaking on the cut) and one `impact_boom` on the cut frame, then let it ring out as the light exhales.

## Common mistakes

- Light-mode films, where there is no dark to release from.
- A second swell in the same film.
- Soft multi-hue bloom on a brand that bans glows; use the hard-disc version.
- Avoid when: Light-mode films, or a second time in the same film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-light-swell-bridge`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
