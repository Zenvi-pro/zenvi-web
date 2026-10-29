---
id: letter-indexed-object-then-look-cycle
kind: technique
summary: "When a collection is the story: repeat 6-7 s units of object close-up with a typed word, then three looks."
categories: [fashion-beauty-ad]
tools: [add_clip_to_timeline_tool, add_kinetic_title_tool, generate_tts_and_add_to_timeline_tool, unify_grade_tool, add_sfx_tool]
pace: medium
mood: [editorial, playful, rhythmic]
aspect: ["9:16", "16:9", "4:5"]
pairs_with: [persistent-frame-mask-over-whole-video, multi-panel-and-card-video-layout, accelerating-cut-length-ramp]
avoid_with: [sentence-split-rapid-hook, karaoke-word-highlight-captions]
needs: [underlined-initial-type-on]
---

# Letter-indexed object-then-look cycle

## What it is
An A-to-Z (or 1-to-N) structure: each unit opens on the object (a jewel,
a brush, a fabric) in close-up with its word typed top-left ("a — adornment"),
spoken as a letter, then three looks that use it (close, medium, wide). The
unit repeats metronomically, about 7 s each.

## Build it in Zenvi
Per unit at time `t`:
```json
add_clip_to_timeline_tool {"file_id": "<object>", "position_seconds": t, "start_seconds": 1, "end_seconds": 3.4}
add_kinetic_title_tool {"text": "a — adornment", "position_seconds": t + 0.2, "duration_seconds": 2.0,
  "style": "documentary", "animation": "typewriter", "text_size": 0.075, "y": 0.1}
```
then three looks of 1.5-2 s each (`add_clip_to_timeline_tool`), ordered close →
medium → wide; the letter spoken on `t` (`generate_tts_and_add_to_timeline_tool
{"text": "A."}` or a real read). `unify_grade_tool` within a unit; one hue
world per unit is the reference's look.
The underlined first glyph that types on the rest needs
`underlined-initial-type-on`; fallback: typewriter as above.

## Timing & taste rules
- Units 6-7.5 s, the same length every time (metronome); object shot 2-3.6 s.
- Every shot advances by the full shot length: an object clip shorter than
  its slot leaves black (the test had a 1 s gap from exactly that).
- Credits or captions sit on the wide look only.
- Words lowercase, small (5-8 % height), top-left or top; one family.

## Sound for it
The spoken letter on the cut; light foley per object (a chime on jewellery,
a brush whisk) at -22 dB; a steady bed.

## Common mistakes
- Looks that do not relate to the object.
- Unit lengths drifting; the cycle stops reading.
- Jumping between unrelated grades inside a unit (the judge's note).

## Verified
2026-10-28: 13.6 s test, two units (jewellery + three portraits; brushes +
lipstick looks), typewriter words, groove bed. Contact sheet: typed word on the
object shot, looks follow. First render had a 1 s black gap (object clip too
short for its slot). Watch judge typography 3, overall 2.73: word styling weak
on the busy object frame, units' grades unrelated; pick objects on plain grounds.
