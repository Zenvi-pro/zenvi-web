---
id: cinematic-title-sequence
kind: technique
summary: When a film needs its name on screen - a restrained title over a slow dark shot or black, faded in whole, held.
categories: [movie-game-trailer, documentary-true-story, travel-cinematic-montage, brand-story-corporate, wedding-event-film, music-lyric-video]
tools: [add_kinetic_title_tool, fade_clip_tool, add_sfx_tool, add_clip_to_timeline_tool, automate_volume_tool]
pace: calm
mood: [restrained, elegant, ominous, reflective]
aspect: ["16:9", "2.39:1", "9:16"]
pairs_with: [cinematic-push-in, cinematic-rack-focus, cinematic-aspect-ratio-reveal, cinematic-trailer-sound, cinematic-j-l-cut]
avoid_with: [cinematic-whip-cut, cinematic-montage-rhythm]
needs: [title-tracking-animate]
---

# Title sequence (main title)

## What it is

The film's name, set small and calm: picture fades up from black, the title fades in over a
slow shot (fog, a road, a face in shadow) or on black, holds long enough to read twice, and
leaves with the picture. In documentaries it comes after the cold open; in trailers it is the
last card. Shines wherever the edit needs to say "this is a film".

Related shot cards: `shot-letterspace-materialize` (wide-tracked wordmark drawn on), `shot-brand-ink-open`, `shot-crane-rise-reveal`.

## Build it in Zenvi

1. Background shot, slow and dark, at least title + 2 s long: `add_clip_to_timeline_tool`; check the
   file is long enough for `start_seconds` + duration (short stock silently ends early).
2. `fade_clip_tool` `{"clip_id", "fade_in_seconds": 1.5, "fade_out_seconds": 1.5}`.
3. `add_kinetic_title_tool` `{"text": "THE LONG WINTER", "position_seconds": 1.4, "duration_seconds": 3.4,
   "style": "editorial", "animation": "fade", "stagger_seconds": 0, "emphasis": "none",
   "text_size": 0.11, "y": 0.5}` - `documentary` style for a sans, `stack` for a trailer card on
   `background: "#000000"`.
4. Sound: a drone or bed fading in (`automate_volume_tool` `fade_in` 1500 ms), a `reverse_swell` into
   the title's first frame (-14 dB) and nothing on its exit.
Missing: tracked-out letter spacing that slowly widens (`title-tracking-animate`); fake the drift
with a slow `cinematic-push-in` on the background.

## Timing & taste rules

- Fade the whole title in at once (`stagger_seconds: 0`); word-by-word fades looked off-balance to
  the judge because each word lands at its final, left-built position.
- Hold >= 2.5 s for 2-4 words; size 0.08-0.12 of the short side, centred, in the 2.39 band if bars.
- Title out = picture out: end them together with a 1-1.5 s fade, never a hard cut to black.
- One typeface, white or the film's light ink; no outline, no drop shadow box.
- Drawn-on titles (video-shotcraft, Apache-2.0, `shot-letterspace-materialize`): every letter starts and finishes on the same frame (staggered letters were judged wrong there too), ~1.7 s of drawing (50 f; under 1 s you cannot see it drawn, over 2.7 s drags), tracking ~0.6 em, then >= 1 s fully still so the word is read once.
- End any opening title with a full second of stillness before it leaves (`shot-brand-ink-open`).

## Sound for it

Drone or room tone; one `reverse_swell` or a single low `impact_boom` (pitch -8) for trailers.

## Common mistakes

- Busy or bright background (the title disappears) - use fog, sky, shadow or black.
- Background clip shorter than the title (it cut to black mid-title in the first test).

## Verified

2026-10-28, `tech/title-sequence` (fog valley, serif title, drone bed, 5.5 s 720p24). Pass 1: the
stock clip was 5.6 s long and the window started at 2 s, so the picture ended under the title. Pass 2:
judge overall 4.45, sound 5, "a decent base for a restrained cinematic title card", but "awkward
word-by-word fading" and the hard end to black - hence `stagger_seconds: 0` and the shared fade.
