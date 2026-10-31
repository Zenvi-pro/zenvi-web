---
id: cinematic-depth-of-field
kind: technique
summary: When phone-sharp footage of a person needs a fast-lens look - subject stays sharp, the background melts (portrait mode).
categories: [talking-head-captions, brand-story-corporate, documentary-true-story, wedding-event-film, fashion-beauty-ad, ugc-ad-testimonial]
tools: [replace_background_tool, generate_subject_matte_tool]
pace: calm
mood: [premium, intimate, cinematic]
aspect: ["16:9", "9:16", "4:5"]
pairs_with: [cinematic-push-in, cinematic-film-emulation, cinematic-rack-focus, cinematic-halation-bloom]
avoid_with: [cinematic-parallax, cinematic-dolly-zoom]
needs: [focus-pull-between-planes]
---

# Depth-of-field emulation

## What it is

A shallow-focus look made in the edit: the person is cut out by a subject matte and laid over a
blurred copy of the same footage, so a busy room or street becomes soft bokeh behind them. Shines
on interviews, creators at a desk, portraits in a busy place, wedding speeches.

## Build it in Zenvi

1. `replace_background_tool` `{"clip_id": "<footage>", "background": "blur", "blur": 12}` - one undo
   step: generates the person matte if the file has none (`generate_subject_matte_tool`; about
   1-3 min per 30 s of 1080p on a busy machine), blurred footage below, the person cut out on top.
2. Strength: `blur` 8-14 source pixels at 1080p (about 1-1.3 % of the short side) reads as f/2;
   above 20 the cut-out edge starts to show as a halo.
3. A pull from blurred to sharp on the whole frame is `cinematic-rack-focus`.
Only one depth: everything that is not the person is blurred, including objects in front of them.
A real depth matte (several planes, foreground blur) is missing (`focus-pull-between-planes`).

## Timing & taste rules

- Use shots where nothing stands between the camera and the person (the ring light in front of the
  subject was blurred like the wall - the judge's first note).
- Background at least 1.5 m behind the subject in the real shot; a wall right behind them looks cut out.
- Start the clip 1-2 s into the file when possible: the matte model is recurrent and its first
  frames can miss occluded parts (the first test blurred a head behind a frame for ~2 s).
- Keep it on for the whole scene; switching shallow/deep between cuts of one setup looks like an error.

## Sound for it

None.

## Common mistakes

- Hair-heavy or fast-moving subjects against bright backgrounds (halo); check a 100 % frame.
- Objects held in front of the person (frames, glasses of water) get blurred with the background.

## Verified

2026-10-28. Pass 1 (`tech/depth-of-field-v1`: a man holding a red frame in a lake): the matte missed
his head behind the frame for the first 2 s. Pass 2 (`tech/depth-of-field`: a man reading by a ring
light, blur 12): watch judge "the artificial depth of field segmentation cleanly separates the subject
from the blurred background without severe edge tearing"; it flagged the foreground ring light being
blurred and slight haloing at the hair (overall 2.6 for a 4 s fragment with an unrelated music bed).
