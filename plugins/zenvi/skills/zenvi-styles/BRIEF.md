# The brief compiler (step 0 of every edit)

People write one line ("make a reel of my trip", "promo for our app, upbeat").
A senior editor turns that line into a brief before touching the timeline;
the brief is what makes the output look directed instead of assembled. Do it
silently (one inventory call, then thinking, then one save) and save it.

**Never ask the person** unless something essential is missing and cannot be
inferred (whose product it is when there is no name anywhere, a voice-over
script they clearly want read). Decide everything else, and say what you
decided in one line when you report. **Never invent brand facts**: names,
prices, claims, URLs, dates, people. When the piece needs one you do not
have, put it in `missing`, leave a neutral placeholder out of the video (no
fake URL, no "Brand" logo), and say so.

## 1. Read what you have

- The prompt: who it is for, where it goes, what it must make someone do.
  Their exact words, names and colours go into the video verbatim.
- `inspect_media_bin_tool` (one call, a few hundred tokens): every file's
  kind, length, orientation, speech, faces, colours and energy, plus hints.
  Do not open files one by one before this.
- A reference link or "like this one": `ingest_web_video_tool` with
  `intent: "reference"` and take pace and look from it, never its content.

## 2. Infer the frame

| Prompt says | Platform | Aspect | Length |
| --- | --- | --- | --- |
| reel, TikTok, short, story, nothing | Reels / TikTok / Shorts | 9:16 | 15 s (8-30) |
| YouTube, trailer, website hero, LinkedIn video | YouTube / web | 16:9 | 20-30 s |
| feed post, carousel video | Instagram feed | 4:5 or 1:1 | 10-15 s |
| ad, promo with no platform | Reels first | 9:16 | 15 s |

Most footage portrait (the inventory says so): 9:16 even if unsaid. A song in
the bin: the length lands on its phrase (8 or 16 bars at its tempo).
A voice-over: the length is the voice plus 1-1.5 s of end card.

## 3. Pick the style, the techniques and the direction

Open the index (`SKILL.md`). Pick ONE style by what the first five seconds
must be, not by the subject. Then at most four techniques, each borrowed for
one named moment and a reason ("flash frames on the drop at 7.5 s: the
energy peak"). More than four, or one with no moment, is a sampler, not a
style. Never borrow what the style's Mix-and-match says to avoid. Copy each
technique's `tools` from the index into the brief.

**3b. The creative-direction draw.** Templates come from habit: the same
look, rhythm and opening every time. `read_director_recipe {styles: "brief"}`
ends with a fresh draw (art style, palette, type, rhythm, camera,
transitions, finish, copy tone, opening, ending) that avoids the last edit's
picks on this machine. Take at least 3 axes into **direction**, each with a
`why`: keep the drawn pick, or re-draw one that fights the subject and say
why; never slide back to the last edit's picks. The save receipt says when
you did.

## 4. Motifs, then the storyboard

The method is `METHOD-motif.md` (this folder; after Tweenkit's
kinetic-cut-video, see NOTICE); in short:

- **motifs**: 8-12 visual elements only THIS subject has, at least one from
  each of: its tools and instruments, materials and textures, signs and
  units, screens and charts, places and history, the one gesture of the
  trade (for a coffee brand: grinder, crema, roast curve, TDS reading, the
  farm's altitude, the pour). Pick the **through_line**: the motif that
  recurs and opens and closes the piece.
- **storyboard**: one row per shot. `start`, `beats` (length in beats),
  `picture`, `motif` (which motif it grows from), `source` (`media` with its
  `file_id`, or `stock` with the query, `generate` with the prompt,
  `motion`, `3d`, `title`), `composition`, `text_entrance`, `tone`
  (brightness and main colour), `transition` (a motif match cut first: the
  waveform becomes the next shot's trace). The last four columns exist to
  see repetition before cutting. Hard rules (from 6 s on, save lists every one a
  brief breaks as a warning to fix):
  - first and last shot grow from the through-line; every motif is a listed one;
  - lengths vary (1 / 2 / 4 / 8 beats in a curve: set-up, speed-up, breath,
    climax, hold), never all the same;
  - no composition more than twice (centred, object left / type right, full
    bleed, type cropped by the frame, split, diagonal, empty space);
  - three or more text entrances (slam, typed, built from the motif, mask
    wipe, flip, stretch);
  - at least one shot on a bright ground, inverted or filled with the accent;
  - exactly one `climax` row, whose tone no other shot has: the heaviest
    moment breaks the system the rest set up.
  Get 1.5x the media the storyboard needs; the style gives the source count.
- **footage from one film**: the save and `get_brief_tool` receipts list the
  shot plan against the bin ("Footage: 3/7 shots covered ... missing: 2 to
  fetch, 2 to generate") with the one call for each kind. Use the person's
  media first (it belongs to the film; the receipt names files no shot
  uses). Fetch the stock rows in ONE `gather_stock_footage_tool` call with
  `coherence: "shoot"` and `match_file_id` (the person's footage): one
  contributor's shoot across the queries, matching light, grade and lens.
  Generate the `generate` rows as ONE `generate_broll_set_tool` set (one style
  line, one reference image, stills animated; cached), never one generate
  call per shot. After the cut, `unify_grade_tool` on the assembled set.
  Product, brand and explainer pieces cut from stock of unrelated shoots read
  as a slideshow however good the cutting.

## 5. Write the rest of the brief

Every field is one or two lines.

- **goal**: what the viewer must do or feel after one watch.
- **audience**, **platform**, **aspect**, **length_seconds**.
- **style** and **techniques** (id, why, tools).
- **hook**: the first 2 s exactly: what is on screen at 0.0 s and what is
  heard. Motion and sound from frame 1; no logo, no "Welcome to", no fade
  from black. The strongest image or the boldest claim goes first.
- **beats**: the structure with timings (the style's table at this length),
  on the music's grid when there is music: hook, build, turn, payoff / drop,
  end card. A picture change starts every beat.
- **type**: two families at most, sizes, how type moves (the style's type
  system); **palette**: the look or LUT and one accent (from their brand or
  the subject's own materials, never a default).
- **music**: tempo, energy curve (where it builds, where it drops, the
  stillness before the climax), from the bin or one search;
  **sound**: what lands on cuts, UI events, the climax (the style's sound
  palette); **captions**: who speaks and how words appear, or none.
- **end_card**: what holds at the end (their name, their URL, a product
  shot); only facts they gave.
- **checklist**: the style's finish checklist, copied (at most 12 lines).

## 6. Critique it, then fix it

Before saving, read the brief against the style's "what separates the best
from average" (its Finish checklist; for a director recipe its Checks and
Pitfalls) and against these, and rewrite what fails:

- **The reskin test.** For each storyboard row: if the copy named another
  subject (a coffee brand instead of a university), would this picture still
  work? Count those rows in **reskin.generic**. More than a third is a
  template: regrow those shots from the motifs and count again. Save
  warns over a third.
- Does the hook work with the sound off, and does it hit in the first 0.5 s?
- Is there one bold moment, and only one? Is there stillness before it?
- Does every beat start with a picture change and end before it drags (the
  style's longest shot)? Is anything held 2 s in a fast style?
- Is every technique tied to a moment? Would a viewer notice it missing?
- Is there enough media for the cut rate (no clip back within 3 s)?
- Does the end card hold 1 s or more on a fact they gave?
- Is anything invented: a name, a claim, a number, a URL? Move it to `missing`.

Write what you changed in **critique** (one line per fix). Then:

```json
save_brief_tool {"goal": "Make runners want the new trail shoe after one watch", "platform": "Instagram Reels", "aspect": "9:16", "length_seconds": 15, "style": "hype-reel", "techniques": [{"id": "speed-ramp", "why": "the wind-up into the drop at 7.5 s", "tools": ["speed_ramp_tool"]}], "hook": "Mud splashes off a sole in slow motion, impact on frame 1, sub hit", "beats": [{"start": 0, "end": 2, "name": "hook"}, {"start": 2, "end": 7.5, "name": "build"}, {"start": 7.5, "end": 13.5, "name": "drop"}, {"start": 13.5, "end": 15, "name": "end card"}], "motifs": ["lugged sole", "mud spray", "laces pulled tight", "trail map contour lines", "altitude readout", "GPS pace screen", "rock and root texture", "the stride"], "through_line": "lugged sole", "storyboard": [{"start": 0, "beats": 4, "picture": "lugged sole hits wet mud in slow motion", "motif": "lugged sole", "source": "stock", "composition": "full bleed", "text_entrance": "none", "tone": "dark wet earth"}, {"start": 2, "beats": 2, "picture": "contour lines draw on over the ridge", "motif": "trail map contour lines", "source": "motion", "composition": "object left / type right", "text_entrance": "typed", "tone": "bright paper map", "transition": "contour line becomes the trail"}, {"start": 3, "beats": 1, "picture": "laces yanked tight, macro", "motif": "laces pulled tight", "source": "stock", "composition": "diagonal", "text_entrance": "slam", "tone": "dark, orange accent"}, {"start": 3.5, "beats": 8, "picture": "altitude counts up as the runner crests", "motif": "altitude readout", "source": "motion", "composition": "type cropped by the frame", "text_entrance": "built from the motif", "tone": "orange accent fill", "climax": true}, {"start": 7.5, "beats": 4, "picture": "the sole again, now clean, held as a poster", "motif": "lugged sole", "source": "stock", "composition": "centred", "text_entrance": "mask wipe", "tone": "dark, orange accent"}], "reskin": {"generic": 1, "note": "the laces macro could sell any shoe"}, "direction": [{"axis": "art style", "pick": "blueprint line drawing", "why": "trail maps are line drawings; last edit was film documentary"}, {"axis": "rhythm", "pick": "slow start, fast finish", "why": "the climb, then the descent"}, {"axis": "opening", "pick": "straight into the hit", "why": "the sole strike is the hook"}], "music": "128 BPM, quiet build, drop at 7.5 s", "checklist": ["a hit on every cut", "one look on every shot", "ends on a held product shot"], "critique": "Moved the logo off the hook; the drop had no stillness before it, added 0.4 s hold; replaced a generic sunset with the altitude readout"}
```

The receipt checks the brief against the project at once (frame, length).
Then set the project to the brief's frame (`set_project_setting_tool`) and
build it with the style's tool sequence.

## 7. Use it while you edit

- The brief is the plan: the director's plan table is the brief's storyboard
  with frames and a sound per row.
- `get_brief_tool` before each stage of a long edit (cut, type, look, sound)
  and when unsure what comes next. It reports beats without a picture change
  and borrowed techniques the timeline does not show yet.
- The edit beats the brief: when a better idea appears, `save_brief_tool`
  again with it (one undo step) rather than drifting silently.
- Before done: `review_edit_tool` lists the brief's misses and its checklist;
  look for every checklist line on the contact sheet. Render receipts and
  `review_render_tool` repeat the hard misses ("Off its brief"): fix them or
  change the brief on purpose.
