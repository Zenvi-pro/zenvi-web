---
id: kinetic-type-motion-design
kind: style
summary: "For type-led promos and manifestos: one idea per beat, ground inversions, one pattern break, a held lockup."
categories: [kinetic-type-motion-design]
tools: [detect_beats_tool, add_kinetic_title_tool, add_motion_block_tool, add_motion_template_tool, add_clip_to_timeline_tool, add_track_tool, add_sfx_tool, automate_volume_tool, master_audio_tool, render_video, review_render_tool]
pace: fast
mood: [bold, clean, confident, rhythmic]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [beat-locked-kinetic-type-cuts, stacked-word-flipper, prompt-bar-typing-hero, grid-cell-reflow-and-collapse, spring-wordmark-or-cta-lockup-and-hold, vo-keyed-emphasis-stack, keyword-slam-card]
avoid_with: [withheld-music-cold-drop, commentary-hits-with-dense-designed-cues, tactile-plate-animation, karaoke-word-highlight-captions]
needs: [type-strobe-sequencer, typographic-layout-variants, lyric-forced-alignment, text-on-path, svg-path-write-on, grid-cell-reflow]
---

# Kinetic type / motion design

## When to use / not
Use: a manifesto or tagline piece, a brand/product teaser told in words, a
lyric or VO-driven type piece, a motion-design showreel moment, 8-60 s.
Families: music-locked type (0.5 s holds), VO-driven explainer type (3-4 s
holds), brand/showreel motion (1-1.3 s). Not for: captions over a talking
head (`talking-head-captions`), a UI product demo (`saas-app-launch`).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-3 hook already moving (prompt bar typing, or a type hit at frame 0) · 3-8 premise: one word per beat, ground inverting · 8-10 pattern break (serif italic line on black) · 10-13 claim (word flipper or grid) · 13-15+ lockup held 1.5-2 s |
| 30 s | hook 0-1 · premise 1-5 · escalation 5-18 (new layout every 0.5-1.3 s) · pattern break at 40-55 % · peak density at 60-85 % · lockup in the last 13 %, held 2-4 s |
| 60 s (VO) | hook · lines keyed to VO words (3-4 s holds) · one black-frame break · a diagram or counter beat · lockup + music stop |

## Shot plan
Every "shot" is a graphic: a type layout, a block, a grid. Footage only as
inserts or backdrops inside cells. One idea per hold; the change lands on a
percussive hit.

## Look & grade
Ink, paper and one or two saturated primaries (cobalt `#1e3cff` + off-white
`#f4f4f0` + near-black is the default family). One ground-inversion rule.
One texture decision for the whole piece: clean vector (default) or print
grit (`apply_fx_tool halftone` / grain) everywhere, never mixed.

## Type system
- One grotesque/condensed sans for hero words, a serif italic only for the
  pattern break or one accent word, mono for 1.5-3 % micro labels.
- Hero words 20-45 % of height: `add_kinetic_title_tool {"style": "creator",
  "emphasis": [<word>], "background": <ground>}` (one centred word filling the
  width); `stack` is left-aligned and small.
- Emphasis ratio 2-3x for lyric/VO type; hero:label 9-30x on spec layers.
- Enter by snap or slam on the beat; overshoot ≤ 115 %; exit by cut.
- Legible: ≥ 0.4 s per short word.

## Motion & transitions
Hard cuts (62 %); the inversion is the flash. Zoom-through into an element or
a shape match between sections; one glitch at the peak at most; no whips. A
camera move only at a scene start (a 12-frame scale snap).

## Sound & music
- Minimal electronic, glitch, lo-fi or future bass at 88-148 bpm (median
  115); a sparse intro, groove by 1-6 s, a clean stop.
- Designed micro-sound on every type/UI event (median 27 cues/min): a hit on
  strong words, a tick on connectors, keyboard foley under typing, a sub +
  swish on the pattern break, a boom + tail on the lockup after a 150 ms
  suck-out. Music-only type pieces exist but score lower on sound.
- Master -14 LUFS, true peak ≤ -1 dBTP.

## Captions/VO
The type is the caption. VO pieces: words pop on the spoken word
(`vo-keyed-emphasis-stack`), music 7-12 dB under. Lyric pieces need word
times (`lyric-forced-alignment` is missing; transcribe or hand-time).

## Tool sequence
1. `detect_beats_tool` on the track; place it with `add_track_tool {"name":
   "Music"}` so beats fall on known timeline times.
2. Hook (0-3 s): `add_clip_to_timeline_tool` a solid plate + `add_motion_block_tool
   prompt_bar` with the premise, `typing_burst` + `mouse_click`; the click is
   the cut (`prompt-bar-typing-hero`).
3. Premise: 8 words, one per beat, grounds inverting, y varied 0.44/0.5/0.56,
   hit on strong words, tick on connectors (`beat-locked-kinetic-type-cuts`).
4. Pattern break: `add_kinetic_title_tool {"style": "editorial", "animation":
   "rise", "emphasis": [<one word>], "background": "#0b0b0d", "text_size": 0.09}`
   for 3 beats, `sub_drop` + `swish_airy`.
5. Claim: `word_rotator` over a solid plate (`stacked-word-flipper`), ticks,
   a thud on the landing word.
6. Lockup: a stack or creator title on the brand ground held 2 s; suck-out,
   boom + tail; or `logo_reveal_end` / `logo_build` for a mark.
7. `master_audio_tool {"preset": "social", "genre": "editorial"}`; render;
   `review_render_tool`.

## Finish checklist
- [ ] A new idea every 0.5-1.3 s, each on a percussive hit.
- [ ] Exactly one pattern break at 40-55 %.
- [ ] 2-4 colours, one inversion rule.
- [ ] Hero:label ratio ≥ 9x where there is data; hero words ≥ 20 % of height.
- [ ] A lockup held ≥ 1.5 s with a stinger or a silence; never cut off on the last beat.
- [ ] A cue on each type/UI event.
- [ ] Every word up ≥ 0.4 s; overshoot ≤ 115 %.
- [ ] One texture decision across the piece.

## Mix-and-match
Borrow: `beat-locked-kinetic-type-cuts`, `stacked-word-flipper`,
`prompt-bar-typing-hero`, `grid-cell-reflow-and-collapse`, the K family
(`families/kinetic.md`: scramble, per-letter, word pop), `spring-wordmark-or-cta-lockup-and-hold`.
Never: footage-led cold drops, commentary hits, paper-sticker textures next
to clean vector, karaoke captions.

## Reference moments
Local only, `~/zenvi-motion/refs2/kinetic-type-motion-design/`: `DTUxRQ1kg-V@0-9.9`
blue/white inversion every 0.5 s; `DTUxRQ1kg-V@5.4` the serif pattern break;
`DTUxRQ1kg-V@10.9` scale-out anchor; `C9KMD79ia-u@0.0` syllable-locked word
pops; `Cyt45e7MXQy@0.0` quantised layout stutter; `Student_Design_Awards_Winner_-_Curiosity_-_Kinetic_Typography@21.6`
VO-keyed emphasis.

## Example (verified)
2026-10-29, 15.3 s, 720x1280, CLI only (`.../styles/kinetic-type-motion-design/`):
a 3 s prompt bar typing "make it hit on the beat" with keyboard foley and a
click; eight words on a 99.5 bpm groove's beats ("CUT ON THE HIT / NOT ON THE
GRID") with cobalt/off-white inversions, hits and ticks; "every frame *earns*
its place" in serif italic on black for 3 beats with a sub; a word flipper
("made for editors / directors / creators / you") on a navy plate with a
landing thud; "CUT TO THE BEAT" lockup held 2.2 s after a suck-out, boom and
tail; mastered.
Pairwise judge vs `DTUxRQ1kg-V` (the full 12.6 s piece): 8.32 vs 6.23, the
candidate won both orders; absolute 8.0. Its notes: make the lockup and the
serif line move a little (a scale settle), ease the cursor. The gradient
behind the prompt bar showed a white glow; the tool sequence uses a solid
plate.
