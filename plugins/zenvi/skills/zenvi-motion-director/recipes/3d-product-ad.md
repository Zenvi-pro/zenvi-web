# 3D product ad

A prompt types the wish, icons burst, a "Generating…" state, then the
product spins in and lands in a clean studio with floating callout chips.
White, soft shadows, few cuts (~2.8 s), the motion carries it. One bold
moment: the landing.

## Structure (12 s, 16:9)

| t (s) | scene | tool |
| --- | --- | --- |
| 0-3.5 | prompt bar types the wish, pointer clicks send, "Generating…" | `prompt_bar` full frame, `palette: "light"` |
| 3.5-4.5 | icons/particles burst from the send button | `particle_burst` over it (`shape: "square"`, `rings: true`) |
| 4.5-8 | the product spins in, lands, camera glides | `add_3d_scene_tool` `device_mockup` (`move: "hero"`) or `glass_hero`; or the AI product still with a scale/rotation pop |
| 8-11 | callout chips around the product | `hud_callouts` over video (`grid: "none"`, `labels`, `values`, `points`) |
| 11-12 | name / tagline | `kinetic_headline` `style: "pop"` |

## Tools

1. Product image: `generate_image_and_add_to_timeline_tool` `prompt:
   "minimal portable music player, white studio, soft shadow, product render,
   3/4 view"`, `position_seconds: 4.5`, `duration_seconds: 6.5`. If
   generation fails, the product is a stock clip on a white background
   (`search_pexels_videos_tool` "white product on white background", "hand
   holding small device white background"), never a generic phone standing in
   for another product.
2. Prompt scene:

```json
add_motion_block_tool {"block": "prompt_bar", "position_seconds": 0, "duration_seconds": 3.5, "placement": "full_frame",
  "params": {"prompt": "I want a minimal portable music player", "status": "Generating…", "palette": "light", "cursor": true}}
add_motion_block_tool {"block": "particle_burst", "position_seconds": 3.3, "duration_seconds": 1.2,
  "params": {"shape": "square", "count": 60, "origin": [{"x": 0.5, "y": 0.55}], "rings": true}}
```

3. 3D (CLI with Blender): `add_3d_scene_tool` `scene: "device_mockup"`,
   `quality: "draft"`, `params: {"device": "phone", "file_id": "<screen
   video>", "move": "hero"}`; look at the draft, then `rerender_3d_scene_tool`
   `quality: "final"`. For a non-device product use `glass_hero` only as an
   abstract accent; the product itself stays the AI still.
   Without Blender: the still with `set_keyframes_tool` `scale_x`/`scale_y`
   `[{seconds: 4.5, value: 0.6}, {seconds: 5.1, value: 1.04, ease:
   "ease_out_back"}, {seconds: 5.35, value: 1}]` and `rotation` `-12 → 0` over
   the same 0.6 s: fast in, small overshoot, settle.
4. Callouts: `add_motion_block_tool` `block: "hud_callouts"`,
   `position_seconds: 8`, `params: {"title": "", "labels": ["Battery",
   "Weight", "Sound"], "values": ["30 h", "86 g", "Hi-Fi"], "points": [...],
   "grid": "none", "palette": "light"}`; read the points off a
   `preview_frame grid: true` of the product.
   Give `points` (where each chip's line lands on the product); without them
   the leaders point at nothing.
5. Close on the name: `kinetic_headline` `style: "pop"`, `palette:
   "light"`, 1.5-2 s, so the piece ends on a word, not on a held render.
6. Sound: `typing_burst` at 0.4 s (as long as the typing), `mouse_click` on
   send, `pop` on the burst, `whoosh_rise` ending on the landing,
   `impact_thud` on it (never `impact_slam` here), `ui_tap` per chip. Music
   clean electronic, quieter than a hype edit (RMS −20…−24 dB).

## Checks

Product frame at landing: no black edges, soft shadow under it, centred or on
a third. Chips not covering the product. Draft vs final 3D: same framing.

## Pitfalls

- Grey or off-white backgrounds mixing: one white (#F7F7F5 or the block's
  light palette) everywhere.
- A slideshow of product stills: one product shot that keeps moving beats
  four that hold.
- Heavy grade on a white studio: no LUT, or `clean_&_denoise` only.
