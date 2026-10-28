---
id: cinematic-push-in
kind: technique
summary: When a held shot needs tension or intimacy - a slow dolly push-in (5-12 % over the shot) instead of a static frame.
categories: [movie-game-trailer, documentary-true-story, brand-story-corporate, travel-cinematic-montage, wedding-event-film, real-estate-tour]
tools: [set_keyframes_tool, align_match_cut_tool]
pace: calm
mood: [tense, intimate, cinematic, reflective]
aspect: ["16:9", "9:16", "2.39:1", "1:1"]
pairs_with: [cinematic-title-sequence, cinematic-rack-focus, cinematic-film-emulation, cinematic-trailer-sound, cinematic-shot-scale-grammar]
avoid_with: [cinematic-dolly-zoom]
needs: []
---

# Slow push-in (digital dolly)

## What it is

The frame creeps toward the subject during the shot, the way a dolly or slider does.
It turns stock stills and locked-off shots into "camera work" and builds tension under
a line or a riser. Shines on faces, a lone figure in a landscape, products on a table,
an interview answer that matters.

## Build it in Zenvi

1. `set_keyframes_tool` `{"timeline_clip_id": "<id>", "property": "scale_x", "points":
   [{"seconds": 0, "value": 1.0}, {"seconds": <shot length>, "value": 1.08, "ease": "ease_in_out_sine"}]}`
   and the same call for `scale_y`. `seconds` are from the clip's start.
2. Off-centre subject: add `location_x` / `location_y` points that move the subject toward
   centre by 1-3 % over the shot (scale goes about the frame centre).
3. Several shots that must push in about a subject consistently (a match-cut chain):
   `align_match_cut_tool` with `zoom_drift: 0.05`.
4. Pull-out (reveal, ending): the same points reversed (1.1 -> 1.0).

## Timing & taste rules

- 5-12 % over 3-6 s. More than ~2.5 % per second reads as a zoom, not a dolly.
- Ease in-out on both ends; a linear push starts with a visible jerk at the cut.
- One push direction per sequence; alternate push-in / static for rhythm, not in / out.
- Sources narrower than the frame (2048x1080, 2.39:1) start at 1.07 so no bars show.
- On the last shot under a title, keep pushing through the title; stopping early feels dead.

## Sound for it

A riser or a swelling pad under it (`add_sfx_tool` `riser_tonal`, length = the push, ending on
the next cut, -14 dB) or just the music; no whoosh (the move is slow).

## Common mistakes

- Pushing every shot (the film starts to breathe like a slideshow Ken Burns).
- Pushing into soft footage past 1.15 at 1080p (the image goes mushy).

## Verified

2026-10-28, `tech/push-in` (man in a lake holding a frame, 5 s 720p24, 1.0 -> 1.12 ease in-out sine):
smooth with no start jerk; at 2.4 %/s it reads as a slow dolly. The 2048-wide source showed thin bars
at 1.0, which the 1.07 rule removes.
