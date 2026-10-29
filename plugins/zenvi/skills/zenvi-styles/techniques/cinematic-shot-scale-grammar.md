---
id: cinematic-shot-scale-grammar
kind: technique
summary: When a scene must read as a story - wide sets the place, medium the subject, close-up the emotion, in order.
categories: [documentary-true-story, brand-story-corporate, movie-game-trailer, wedding-event-film, real-estate-tour, travel-cinematic-montage]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, set_clip_property_tool]
pace: calm
mood: [storytelling, grounded, intimate]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [cinematic-match-on-action, cinematic-j-l-cut, cinematic-push-in, cinematic-title-sequence]
avoid_with: []
needs: [shot-heading-scale-tagger]
---

# Shot-scale grammar (wide -> medium -> close)

## What it is

The basic sentence of film editing: an establishing wide (where), a medium (who, doing what), a
close-up (how they feel) - or reversed, detail first then context, for a mystery or a cold open.
Each step is at least 1.5x tighter. Shines in every story edit; it is what makes stock B-roll feel
like a scene instead of a list.

## Build it in Zenvi

1. Pick shots of one subject in one place (the judge rejected an aerial of another lake as the
   "wide" twice: the wide must contain the subject or clearly be its place).
2. Lay them in order with `add_clip_to_timeline_tool` (wide 2.5-3.5 s, medium 1.8-2.5 s, close 1.5-2 s).
3. Missing a close-up: punch in on the medium - `set_keyframes_tool` `scale_x`/`scale_y`
   `[{"seconds": 0, "value": 2.2}]` and `location_y` `[{"seconds": 0, "value": 0.3}]` (positive moves the
   picture down; keep |location| <= (scale - 1) / 2). 1080p sources survive 2.2x at 720p, ~1.6x at 1080p.
4. Sources that are not 16:9: `set_clip_property_tool` `{"property": "scale", "value": 0}` first.
Tagging each shot's scale automatically is missing (`shot-heading-scale-tagger`, GAPS #59): judge it
from a contact sheet.

## Timing & taste rules

- Each step >= 1.5x tighter, same screen direction, eyeline on the same side.
- Shots shorten as they tighten (the close-up is the shortest), except the emotional hold.
- Reverse order (ECU -> WS) for cold opens and reveals: detail, detail, then the room.
- Cut on action between the steps when there is movement (`cinematic-match-on-action`).

## Sound for it

The scene's own ambience continuous across all three (`cinematic-j-l-cut`); no cut sounds.

## Common mistakes

- Two shots of the same size back to back (a jump cut).
- A "wide" from somewhere else.

## Verified

2026-10-28, `tech/shot-scale-grammar`. Passes 1-2 used a lake aerial as the wide: judge "jumping
randomly from a landscape drone shot to an unrelated artistic portrait" (2.8). Pass 3, one subject
(full figure in the lake -> waist-up -> 2.2x punch-in to the face): grade 7/10, overall 4.8; the judge
still wanted a bigger jump from wide to medium (rule 1 of the timing list). Reverse order used in the
documentary showcase's cold open.
