---
id: shot-flash-simplify-wordmark
kind: technique
summary: "When a brand line ends and must become official: a shiny metallic wordmark blows out to white and returns flat."
categories: [brand-story-corporate, product-launch-film, saas-app-launch, automotive-ad, fashion-beauty-ad]
tools: [add_3d_scene_tool, apply_motion_transition_tool, add_title_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [polished, decisive, closing]
aspect: ["16:9", "1:1"]
pairs_with: [cinematic-silence-before-hit, cinematic-trailer-sound, T061]
avoid_with: [shot-hidden-cut-masks, shot-glitch-tear-cut, shot-paparazzi-flash-crops]
needs: [liquid-metal-text]
---

# Flash and simplify wordmark

## What it is
A flowing, iridescent metallic wordmark, a single glint sweeping it, then a charge, a white blow-out from the middle of
the letters, and when the exposure comes back the same word at the same size sits there flat and single-colour. One flash
does the downgrade from sensual to official. Use a made-up or the client's own word; never imitate a known logo.

## Build it in Zenvi
1. The show: `add_3d_scene_tool {"scene": "title_3d", "params": {"text": "BRAND", "style": "chrome"}, "position_seconds": 0,
   "duration_seconds": 1.6}` or the client's mark with `{"scene": "logo_extrude", "params": {"file_id": "<svg>"}}` (run
   `list_3d_scenes_tool` for the exact params). An iridescent flowing text fill is `needs: liquid-metal-text`; chrome is the stand-in.
2. The flash is the cut between the two: `apply_motion_transition_tool {"preset": "flash_white", "clip1_id": "<chrome>",
   "clip2_id": "<flat>", "duration": 0.4, "intensity": 1.5}`.
3. The flat word, same size and place, a flat ink on paper or black:
   `add_title_tool {"text": "BRAND", "template": "Standard_1", "font_weight": "bold", "text_color": "#111111",
   "background_color": "#f4efe6", "position_seconds": 1.6, "duration_seconds": 2.4}` and a `set_keyframes_tool` `scale_x` / `scale_y` 1.03 to 1 over 0.9 s
   `ease_out_cubic`. Tagline words in with `add_kinetic_title_tool {"text": "Craft the shot.", "animation": "rise", "position_seconds": 2.4}`.
4. Charge: `add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 1.6, "duration": 1.3}` ending on the flash,
   `{"recipe": "impact_boom", "at_seconds": 1.6, "gain_db": -10}` on the white.

## Timing & taste rules (30 fps, whole beat about 4 s)
- Show 0-34 f (one glint over the word). Charge 34-46 f (brightness x1.7, a stretched flare through the word), white spreads
  from the centre of the word over 44-50 f (ease-in), pure white 50-54 f, exposure falls 54-76 f (fast then slow, like
  eyes adjusting), flat word locks 72-96 f, hold to 120 f.
- Swap the scene on the all-white frames, 50 f; the white must not leave before then.
- The flat word comes from under the white, in position from the start (1.03 to 1 focus only). A fade-in on top of the
  falling white makes two reveals.
- Same font size and centre in both versions; otherwise it is a reskin, not a purification.
- A white that spreads from the word's centre reads as the letters overexposing; a uniform fade reads as a dissolve.
- Highlights live inside the letters, not as radial spots on top (they smear on dark).
- Texture only in the show; the brand mark appears in the flat version only.

## Sound for it
Mandatory: a charging riser and a boom on the white. A silent white flash reads as a dropped frame.

## Common mistakes
- Flat version appearing by fading in on white.
- Next scene dark while this one ends on paper: add a transition or use the flat end as the cut.
- Using the flash twice in the film.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/transition/white-flash-logo-simplify-cut.md` (Apache-2.0; see ../NOTICE).
