# The motif method — shots grown from the subject, not a template

A templated video has one tell: **swap its copy for another subject and every picture still works.** This method
stops that. It is the planning half of the brief (`BRIEF.md` §4 and §6, `save_brief_tool`'s `motifs`,
`through_line`, `storyboard`, `reskin`, `direction`), and it is how every `kinetic-cut` piece is planned. It is
adapted from Tweenkit's kinetic-cut-video skill (MIT; see `NOTICE`).

## 1. Motifs (before any tool call)

Write **8-12 visual elements only this subject has**, at least one from each row. "Tech feel" and "light effects"
are not motifs.

| Kind | Ask | Electronics school | Specialty coffee | Hospital |
|---|---|---|---|---|
| Tools & instruments | What do its people touch and read every day? | oscilloscope, multimeter, soldering iron | grinder, gooseneck kettle, thermometer | ECG monitor, stethoscope, microscope |
| Materials & textures | What is it made of; what is it close up? | wafer, PCB traces, solder joints | grounds, crema, kraft paper | cells, blister foil, gauze weave |
| Signs & units | Marks, units, codes of the trade | circuit symbols, Verilog, Morse | roast curve, flavour wheel, farm coordinates | ECG trace, prescription, the cross |
| Screens & charts | What do insiders look at? | spectrum analyser, logic analyser | brew timer, TDS reading | monitor digits, CT slices |
| Places & history | Where, since when, what old objects? | old school name, founding year, campus map | farm altitude, port, sack stencils | the first ward, the old building |
| The gesture | The one action of the trade | routing, soldering, the LED lighting up | the pour, extraction, latte art | listening, scanning, the stitch |

Pick the **through-line**: the motif that recurs, opens the piece and closes it ("one signal"). The others are shot
material. Names, years and numbers come from the person; anything you would have to invent goes to `missing`.

## 2. The storyboard: every shot says which motif it grows from

One row per shot — `save_brief_tool`'s `storyboard` fields:

| start | beats | picture | motif | source | composition | text_entrance | tone | transition |
|---|---|---|---|---|---|---|---|---|

The last four columns exist to **see repetition before you cut**. Hard rules (save refuses a brief that breaks them
from 6 s on):

- **At least half the shots use a technique made for this subject** (a scope trace, a routing animation, the pour),
  not a stock effect with the copy changed. A reused effect appears once, reshaped to the subject (`+bars` become
  dies on a wafer; `+routes` converge on the product).
- **First and last shot grow from the through-line.** Open on a subject picture, never a generic light burst.
- **Lengths vary**: 1 / 2 / 4 / 8 beats in a curve — set-up, speed-up, breath, climax, hold. Never all equal.
- **No composition more than twice**: centred, object left / type right, full bleed, type cropped by the frame
  (at least once), split, diagonal, empty space (at least once).
- **Three or more text entrances**: slam, typed, built from the motif (dots, traces, particles), mask wipe, flip,
  stretch. Not every title through the same entrance.
- **A value rhythm**: at least one bright, inverted or accent-filled full frame; exactly one `climax` row whose tone
  no other row has — the heaviest moment breaks the system the rest set up (ground, scale, rhythm).
- **Two layers of motion in every shot**: the main action (entrance, morph) plus a continuous secondary one (slow
  push, drift, particles, a scan), and a small second event in the shot's second half, so nothing stops once the
  type lands.
- **Transitions are motif match cuts first**: this shot's waveform becomes the next one's trace, the traces converge
  into the chip, the chip's glint becomes the next shot's light. A flash cut is the fallback, not the default.

Rhythm: cuts and slams on the beat grid (or the music's onsets: `detect_beats_tool`), a new shot or event every
1-2 s, 0.25 s cuts in the climax run, the first impact inside 0.5 s. Test: pause on any frame and it is a poster;
any second has something new. Copy is minimal and huge (the main word 60-95 % of the frame width, or cropped on
purpose), one sub line per shot at most, in the subject's own words.

## 3. The other axes are not defaults either

| Axis | The template default | Instead |
|---|---|---|
| Music | 120 BPM, a pad and a kick | the brief's style, tempo, key and instruments; a sound on every cut, a riser or a gap before a section change |
| Palette | ink black + ivory + one orange | from the subject's materials and the creative-direction draw |
| Type | bold serif + small mono | the brief's type personality (`display_font`) |
| Finish | flash + aberration + punch on every cut | `look` (clean / punchy / wild) chosen for the subject |
| Decoration | corner brackets and a timecode | none, or the subject's own marks (scale ticks, page numbers, coordinates) |
| Camera | only punch-ins | one camera grammar for the piece (locked-off hard cuts, a continuous push through, lateral moves, split screens), varied in direction, speed and scale — three moves at least |
| Opening / ending | light converges / particle logo + power-off line | the through-line, both ends |

Take a **creative-direction draw** (the brief compiler hands one out; `direction` in the brief): art style, palette
strategy, type, rhythm structure, tempo, music style, camera, transitions, finish, copy tone, opening, ending,
decoration — at least three axes, each with a `why`. Re-draw an axis that fights the subject and say why; never slide
back to the last edit's picks.

## 4. The reskin test (after the storyboard, and again on the contact sheet)

For each shot: if the copy named another subject (a coffee brand instead of an electronics school), would this
picture still work?

- Yes → the shot is a template: regrow it from a motif.
- More than a third of the shots pass as "yes" → the plan is a template: redo the storyboard (`reskin.generic`
  counts them; save refuses over a third).

Then compare with the last piece you made: the same shot order or the same technique mix is a template too.

## 5. Check the render, not just the plan

`review_render_tool` measures what stills cannot: shot lengths that never vary, a shot that sits still over 0.6 s,
brightness and hue that barely move across shots, and cuts with no sound on them (fast cuts only). Fix every warning
or say in the delivery note why it stays. It cannot judge whether shots come from the motifs, or whether compositions
and entrances repeat: check those against the storyboard yourself.

## Two worked motifs

Each new technique is a pure function of time and its arguments. In Zenvi most of these already exist as
`kinetic_cut_scene` layers; the point is the habit of drawing from the subject:

- **Oscilloscope (motif: signal)** — a graticule, a flat trace that draws on and swells into a wave on the beat, three
  strokes (wide faint, medium, thin bright) for phosphor glow: `+scope`.
- **Auto-routing (motif: circuit board)** — traces enter from both sides in 90° / 45° runs and converge on the
  product; pads pop where they land: `+routes`.

More directions (write your own for the subject): Morse tape (dots and dashes on the beat, the tape sliding, the
decoded letters printing), a wafer (a round grid lighting cell by cell, the camera pushing into one die), a spectrum
analyser (bars jumping with noise, a label on the peak), latte art (concentric curves dragged into a heart), an ECG
(a trace drawn on, cutting on its peak), a route map (graticule + arcs drawn on, cities lighting in turn), a seal or
brush stroke (strokes wiped on through a mask), film (sprocket strip sliding, grain, a light leak).
