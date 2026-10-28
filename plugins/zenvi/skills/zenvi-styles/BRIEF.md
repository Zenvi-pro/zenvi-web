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

## 3. Pick the style and the techniques

Open the index (`SKILL.md`). Pick ONE style by what the first five seconds
must be, not by the subject. Then at most four techniques, each borrowed for
one named moment and a reason ("flash frames on the drop at 7.5 s: the
energy peak"). More than four, or one with no moment, is a sampler, not a
style. Never borrow what the style's Mix-and-match says to avoid. Copy each
technique's `tools` from the index into the brief.

## 4. Write the brief

Every field is one or two lines; the whole brief stays under 400 words.

- **goal**: what the viewer must do or feel after one watch.
- **audience**, **platform**, **aspect**, **length_seconds**.
- **style** and **techniques** (id, why, tools).
- **hook**: the first 2 s exactly: what is on screen at 0.0 s and what is
  heard. Motion and sound from frame 1; no logo, no "Welcome to", no fade
  from black. The strongest image or the boldest claim goes first.
- **beats**: the structure with timings (the style's table at this length),
  on the music's grid when there is music: hook, build, turn, payoff / drop,
  end card. A picture change starts every beat.
- **shots**: each beat's shots mapped to the person's files by id
  (`source: "media"`); what is missing becomes `stock` (the query you will
  pass to `gather_stock_footage_tool`), `generate` (the prompt), `motion`
  (the block), `3d` (the scene) or `title`. Get 1.5x the shots the beats
  need; the style gives the source count.
- **type**: two families at most, sizes, how type moves (the style's type
  system); **palette**: the look or LUT and one accent (from their brand or
  their footage's colours in the inventory, never a default).
- **music**: tempo, energy curve (where it builds, where it drops, the
  stillness before the climax), from the bin or one search;
  **sound**: what lands on cuts, UI events, the climax (the style's sound
  palette); **captions**: who speaks and how words appear, or none.
- **end_card**: what holds at the end (their name, their URL, a product
  shot); only facts they gave.
- **checklist**: the style's finish checklist, copied (at most 12 lines).

## 5. Critique it, then fix it

Before saving, read the brief against the style's "what separates the best
from average" (its Finish checklist; for a director recipe its Checks and
Pitfalls) and against these, and rewrite what fails:

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
save_brief_tool {"goal": "Make runners want the new trail shoe after one watch", "platform": "Instagram Reels", "aspect": "9:16", "length_seconds": 15, "style": "hype-reel", "techniques": [{"id": "speed-ramp", "why": "the wind-up into the drop at 7.5 s", "tools": ["speed_ramp_tool"]}], "hook": "Mud splashes off a sole in slow motion, impact on frame 1, sub hit", "beats": [{"start": 0, "end": 2, "name": "hook"}, {"start": 2, "end": 7.5, "name": "build"}, {"start": 7.5, "end": 13.5, "name": "drop"}, {"start": 13.5, "end": 15, "name": "end card"}], "shots": [{"beat": "hook", "source": "stock", "note": "trail running shoe close-up mud splash slow motion"}], "music": "128 BPM, quiet build, drop at 7.5 s", "checklist": ["a hit on every cut", "one look on every shot", "ends on a held product shot"], "critique": "Moved the logo off the hook; the drop had no stillness before it, added 0.4 s hold"}
```

The receipt checks the brief against the project at once (frame, length).
Then set the project to the brief's frame (`set_project_setting_tool`) and
build it with the style's tool sequence.

## 6. Use it while you edit

- The brief is the plan: the director's plan table is the brief's beats and
  shots with frames and a sound per row.
- `get_brief_tool` before each stage of a long edit (cut, type, look, sound)
  and when unsure what comes next. It reports beats without a picture change
  and borrowed techniques the timeline does not show yet.
- The edit beats the brief: when a better idea appears, `save_brief_tool`
  again with it (one undo step) rather than drifting silently.
- Before done: `review_edit_tool` lists the brief's misses and its checklist;
  look for every checklist line on the contact sheet. Render receipts and
  `review_render_tool` repeat the hard misses ("Off its brief"): fix them or
  change the brief on purpose.
