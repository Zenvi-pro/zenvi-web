---
id: circular-problem-to-proof-bookend
kind: technique
summary: "When an ad has a visible problem: open on the problem in macro, end on the same gesture with zero residue."
categories: [ugc-ad-testimonial]
tools: [search_clip_scenes_tool, trim_clip_tool, split_clip_tool, add_clip_to_timeline_tool, swap_shot_tool, add_kinetic_title_tool, add_sfx_tool]
pace: fast
mood: [satisfying, credible, punchy]
aspect: ["9:16", "4:5", "1:1"]
pairs_with: [action-per-cut-micro-demo-with-live-foley, split-screen-compare-layout, screen-capture-zoom-onto-the-number]
avoid_with: [negative-space-chapter-breath, letter-indexed-object-then-look-cycle]
needs: []
---

# Circular problem-to-proof bookend

## What it is
The first 2 s show the problem as a visceral macro (a spatula scraping thick
foundation, a stain, a grimy sink), cut 2-3 times under 1 s each; the last shot
repeats the same angle and gesture on the clean result. The rhyme is the proof.

## Build it in Zenvi
1. The pair must exist in the footage (Zenvi cannot make the second shot):
   `search_clip_scenes_tool` for the problem and the proof gesture.
2. Hook: three cuts of 0.6-0.9 s from the problem take
   (`add_clip_to_timeline_tool` with different in-points), extreme close.
3. Demo in the middle (`action-per-cut-micro-demo-with-live-foley`).
4. Proof: the same framing and gesture, 1.5-2.5 s; `swap_shot_tool` if a take
   matches the hook's framing better.
5. Words, small and few: `add_kinetic_title_tool` "again?" on the hook and
   "clean." on the proof (`style: "creator"`, the word as emphasis); or none.

## Timing & taste rules
- Hook ≤ 2.2 s with 2-3 cuts under 1 s; proof shot ≥ 1.5 s.
- Same lens, angle and direction in the first and last shot: the viewer
  should feel the rhyme without words.
- Problem and proof in extreme close; a wide wash shot does not read as
  "problem" (the judge's main note on the test).

## Sound for it
A gross, close foley on the problem (scrape, squelch), a clean squeak or
chime on the proof at -12 dB; quiet bed or none.

## Common mistakes
- Reusing the identical clip for both ends (the proof must differ: clean).
- Big red title slapped over the problem; let the picture speak.

## Verified
2026-10-28: 7.4 s test, face-wash wide (three hook cuts), dropper and cream
demo, the same wash take as the ending with "again?" / "clean." titles,
lofi bed. Watch judge typography 2, overall 2.82: the stock had no macro
problem/proof pair, so the rhyme was only the same clip; the technique needs
that pair shot or found, which the skill now states first.
