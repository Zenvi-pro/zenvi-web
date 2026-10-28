---
id: cinematic-whip-cut
kind: technique
summary: When two shots should feel like one camera move - a whip pan smears out of one and lands in the next, with a whip sound.
categories: [travel-cinematic-montage, automotive-ad, sports-hype-edit, movie-game-trailer, gaming-montage, wedding-event-film]
tools: [apply_motion_transition_tool, apply_motion_transitions_tool, add_sfx_tool]
pace: fast
mood: [energetic, kinetic, playful, bold]
aspect: ["16:9", "9:16", "2.39:1"]
pairs_with: [cinematic-speed-ramp, cinematic-match-on-action, cinematic-teal-orange, cinematic-montage-rhythm]
avoid_with: [cinematic-title-sequence, cinematic-j-l-cut, cinematic-rack-focus]
needs: []
---

# Whip cut (whip-pan transition)

## What it is

The camera snaps sideways so fast the image streaks; the next shot arrives mid-streak and
settles. It joins locations or angles as one gesture. Shines in travel, car and sport
edits and in trailer action runs; wrong in calm documentary and story scenes.

## Build it in Zenvi

1. One cut: `apply_motion_transition_tool` `{"preset": "whip", "clip1_id": "<outgoing>",
   "direction": "left"}` (8 frames at 30 fps by default; `duration` 0.2-0.35 s, `intensity` 1).
2. Several cuts with one direction: `apply_motion_transitions_tool` (same preset; it keeps the
   track's direction).
3. Sound on the cut frame: `add_sfx_tool` `{"recipe": "whip", "at_seconds": <cut>}` (peaks on
   the cut; vary `seed`), or `whoosh_short` with `pan` following the direction (left whip:
   `pan: -0.5`).
4. Footage that already pans fast: cut on the pan frame (no transition) and still add the whip sound.

## Timing & taste rules

- 6-10 frames total; longer is a slide, not a whip.
- One direction per sequence (left by default); `up` is a reserved accent, at most once.
- At most one whip per 3-4 cuts; a whip on every cut is the template look the dossiers flag.
- Best when the outgoing shot already moves in the whip's direction (pan or subject motion);
  cut on movement, not on a still frame.
- Land the whip on a beat or the off-beat before a downbeat.

## Sound for it

`whip` or `whoosh_short` at -12 to -16 dB, peak on the cut frame, panned with the move
(screen x x 0.5); never the same sample twice in a row.

## Common mistakes

- Whip between two static, locked-off shots with no motion (reads as a glitch).
- Mixing whip directions in one run.
- No sound: a silent whip looks like a dropped frame.

## Verified

2026-10-28, `tech/whip-cut` (three night car shots, 7.5 s 720p24, two left whips + `whip`
sounds). Watch judge (abs): transitions 6/10, overall 5.0, "the directional whip transition
between the static cars works well and syncs effectively with the accompanying swoosh SFX";
it flagged the static outgoing shots (rule 4).
