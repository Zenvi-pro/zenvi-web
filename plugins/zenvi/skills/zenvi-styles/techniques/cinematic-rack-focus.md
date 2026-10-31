---
id: cinematic-rack-focus
kind: technique
summary: When a shot should open on a reveal - start soft, pull focus sharp onto the subject; for openers, eyes, products, names.
categories: [movie-game-trailer, documentary-true-story, product-launch-film, brand-story-corporate, wedding-event-film]
tools: [add_effect_tool, set_effect_property_tool]
pace: calm
mood: [mysterious, intimate, cinematic]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [cinematic-title-sequence, cinematic-push-in, cinematic-trailer-sound, cinematic-depth-of-field]
avoid_with: [cinematic-montage-rhythm, cinematic-whip-cut]
needs: [focus-pull-between-planes]
---

# Rack focus (focus pull)

## What it is

The lens racks from out of focus to sharp (or between two planes) so the viewer's eye
lands where the director wants. Shines on the first shot of a trailer, an eye or a face
in a documentary open, a product detail, a name on a door.

Related shot card: `shot-tension-camera-moves` (focus falling off the surroundings in a pull-back).

## Build it in Zenvi

1. `add_effect_tool` `{"timeline_clip_id": "<id>", "effect": "Blur", "properties":
   {"horizontal_radius": [{"time": 0, "value": 18}, {"time": 0.6, "value": 18}, {"time": 2.2, "value": 0}],
    "vertical_radius":   [{"time": 0, "value": 18}, {"time": 0.6, "value": 18}, {"time": 2.2, "value": 0}]}}`
   (times are timeline seconds; the clip here starts at 0).
2. Reverse it (sharp to soft) on the last shot before a title card.
3. Fine-tune one point: `set_effect_property_tool` `{"effect_id": "<effect_id>", "property": "horizontal_radius",
   "value": 0, "at_seconds": 2.0}`.

What it cannot do: a true pull between two planes (foreground sharp → background
sharp). Blur is uniform over the frame; `needs: focus-pull-between-planes` (a depth or
subject matte driving the blur). Fallback for two planes: `cinematic-depth-of-field`
(subject sharp, background blurred) and then remove the background blur over time.

## Timing & taste rules

- Hold soft 0.4-0.8 s, pull over 1.2-2 s with an ease-out (bezier, the default); a linear 0.3 s
  pull reads as a glitch.
- Radius 12-20 at 720p-1080p; above 25 the image turns to fog and the reveal is lost.
- One rack per 20-30 s; it is a punctuation mark.
- Land the sharp frame on a sound (a low `impact_thud` at -14 dB or the first note).

## Sound for it

A `reverse_swell` (0.8-1.5 s) that ends on the sharp frame, or a soft riser; in a
documentary, just the room tone growing.

## Common mistakes

- Pulling focus on a shot that is already moving fast (nobody sees it).
- Leaving the clip at radius 0 but with the effect on (harmless) - remove it if you retime.

## Verified

2026-10-28, `tech/rack-focus` (eye close-up, 4 s 720p24). The eye goes from fog to
sharp lashes by 2.2 s; the pull reads as a lens move, not a fade.
