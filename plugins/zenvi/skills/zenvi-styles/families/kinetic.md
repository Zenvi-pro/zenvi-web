# Kinetic type family — how the `kinetic-*` techniques combine

Read this after the style is chosen and before placing any type. The style file says *what* the edit says; this file
says which type motions carry it, and which never share a scene.

## The rules

1. **Never more than two type motions per scene** (a scene = one shot or one card, or 2-4 s of edit). One is the hero
   motion (the thing the eye follows), the other is support (a caption, a label, a lower third). A third motion makes
   the viewer read the animation instead of the words.
2. **But always two layers of motion per shot** (from the kinetic-cut method): the type's entrance *plus* a continuous
   secondary move — a slow push or drift on the footage or background, breathing, particles, a scan — and one small
   event in the second half of the shot, so the frame never freezes after the words land. This is not a third type
   motion; it lives in the picture. Build it with `set_keyframes_tool` on the footage/background clip (scale 1.0 → 1.04-1.08
   over the shot), a moving backdrop block (`gradient_field`, `line_trails`), or the shot's own camera move — not on the
   title clips, whose scale/alpha curves are their entrance (setting them replaces it). "Static after it lands" was the
   watch judge's most common note on the isolated technique tests (word-pop, emphasis-scale, mask-reveal, quote-card,
   text-behind-subject, karaoke, lyric-sync).
3. **One type system per edit**: one display face + one text face (+ mono for labels when there is data), ink, paper and
   one accent. The motions change scene to scene; the faces and colours do not.
4. **Nothing repeats by default** (kinetic-cut storyboard columns, see `../METHOD-motif.md`):
   - shot/hold lengths mixed from **1 / 2 / 4 / 8 beats** with a curve — set-up, accelerate, breathe, climax, freeze —
     never the same count for every shot;
   - **≥ 3 different text entrances** in an edit with 6+ type moments (e.g. slam, typed, mask wipe, letters, morph);
   - a composition is used **at most twice**; at least one shot where the type bleeds off the frame and one with a large
     empty field;
   - **at least one full-bright, inverted or accent-filled frame**, and **the climax breaks the system** — another ground
     colour, scale or rhythm — or the heaviest hit looks like every other shot;
   - the **reskin test**: if a shot would still work with another subject's copy, it is a template — make it from the
     subject (letter-swap tile, tracked label, the product's own number) instead.

## kinetic-cut (the style) vs these techniques

`styles/kinetic-cut.md` (the `kinetic_cut` style, ported from Tweenkit's MIT kinetic-cut skill), its `techniques/kcut-*.md`
and `METHOD-motif.md` are a whole-edit method: a beat-synced quick-cut motion piece where every shot is drawn from the
subject's own motifs (8-12 subject-specific elements, one through-line motif), with hit-driven camera punch, shake,
chromatic aberration, flash and bloom on the beat grid. The `kinetic-*` files here are single type moves that work in
any style, over footage or on cards.

| the brief is… | use |
| --- | --- |
| a 10-30 s beat-cut motion piece with little or no footage (school/brand intro, launch sting, data highlight), every shot designed | the **kinetic_cut** style + `METHOD-motif.md` storyboard; take its type entrances from this family (below) |
| type over footage: captions, talking heads, titles in a documentary, a lower third, a quote, a spec label | **kinetic-*** techniques inside whatever style the edit has |
| a footage montage that needs a type hook or lockup | the montage style + one or two **kinetic-*** moments (keyword-slam, beat-strobe, 3d-title, letter-cascade) |
| a lyric or VO piece | **kinetic-lyric-sync** / **kinetic-vo-captions**; kinetic-cut only for a drop or an intro sting |

Inside a kinetic_cut edit the text entrances come from here: slam → `kinetic-keyword-slam`, typed → `kinetic-typewriter`,
mask/wipe → `kinetic-mask-reveal`, letters → `kinetic-letter-cascade`, flip/rotate → `kinetic-word-rotator`, decode →
`kinetic-scramble-decode`, morph → `kinetic-type-morph`, strobe → `kinetic-beat-strobe`, number → `kinetic-counter`, word
made of the subject → `kinetic-letter-swap`. Ids do not overlap: `kinetic-*` is this family, `kcut-*` is the style's own
shot techniques (hit FX, motif drawings, particles that assemble). A `kcut-*` file that needs one of these type moves
names the `kinetic-*` id in `pairs_with` instead of redefining it; if both ever describe the same move, the `kinetic-*`
file keeps the type rules and the `kcut-*` file keeps the hit/FX timing.

## Pick by pace

| pace | hero motions | support motions | cut / change rate |
| --- | --- | --- | --- |
| calm | kinetic-title-sequence, kinetic-quote-card, kinetic-write-on, kinetic-mask-reveal, kinetic-type-morph | kinetic-lower-third, kinetic-typewriter | a new idea every 2-6 s; fades allowed |
| medium | kinetic-emphasis-scale, kinetic-word-rotator, kinetic-letter-cascade, kinetic-letter-swap, kinetic-counter, kinetic-3d-title, kinetic-text-behind-subject, kinetic-stencil-reveal, kinetic-lyric-sync | kinetic-scramble-decode, kinetic-tracked-label, kinetic-karaoke | 1-2 s holds; exits by cut |
| fast | kinetic-vo-captions, kinetic-word-pop, kinetic-keyword-slam | kinetic-emphasis-scale (inside the captions), kinetic-counter | a word or line per 0.3-1.3 s, on the voice or the hits |
| frantic | kinetic-beat-strobe, kinetic-echo-stack | kinetic-keyword-slam (as the lockup) | 3-12 frames per change, on onsets; one held lockup |

## Pick by mood

| mood | use | keep out |
| --- | --- | --- |
| premium / calm launch | mask-reveal, word-rotator, type-morph, 3d-title (glass/chrome), counter | echo-stack, beat-strobe, word-pop |
| creator / direct | vo-captions + emphasis-scale, text-behind-subject, keyword-slam, lower-third | quote-card, write-on, title-sequence |
| editorial / crafted | letter-swap, quote-card, mask-reveal (serif accent), scramble labels, write-on | 3d-title, echo-stack |
| tech / spec | scramble-decode, counter, tracked-label, typewriter | write-on, lyric-sync |
| hype / sport / gaming | beat-strobe, echo-stack, keyword-slam, letter-cascade, stencil-reveal | quote-card, type-morph |
| cinematic / documentary | title-sequence, quote-card, typewriter (places, dates), lower-third | word-pop, echo-stack, karaoke |
| music / lyric | lyric-sync, text-on-path, beat-strobe (on the drop only) | vo-captions, karaoke, emphasis-scale |

## Pairs that work in one scene (hero + support)

- vo-captions + emphasis-scale (the emphasis is part of the captions) — talking heads.
- vo-captions + lower-third (only on the speaker's first appearance; move captions up while it is on).
- text-behind-subject + vo-captions (the behind word is the hook, captions start after it lands).
- counter + scramble-decode (number is hero, the label decodes) — specs.
- mask-reveal + word-rotator (headline then tagline slot) — launch end cards.
- 3d-title + mask-reveal (3D word, a one-line subtitle rising under it).
- keyword-slam + vo-captions (the slam replaces the captions for its 1 s; never both on screen).
- beat-strobe → keyword-slam (the strobe ends on a slam lockup).

## Never in the same scene

- Two entrances on the same words (pop + typewriter, scramble + letter-cascade, rise + pop).
- karaoke + vo-captions (two caption systems).
- echo-stack or beat-strobe with anything calm (quote-card, write-on, type-morph, title-sequence).
- lyric-sync with emphasis-scale (lyric type keeps one size).
- stencil-reveal + text-behind-subject (two matte tricks fight over the same subject).

## Across a whole edit

- **Hook (0-1 s)**: the first frame already moving — text-behind-subject, keyword-slam, typewriter prompt, beat-strobe.
- **Body**: one hero motion family for the body (captions *or* headlines), the support motions where the content needs
  them (a name, a number).
- **Pattern break at 40-55 %**: change one rule once — a serif italic word, a black slam card, a quote card, a scale-out.
- **Climax at 60-85 %**: the system breaks — the densest cutting (down to 1 beat or 0.25 s), a new ground or an
  inverted frame, the biggest scale — then the lockup.
- **Lockup**: one end card held ≥ 1.5 s (letter-cascade wordmark, word-rotator landing, 3d-title, mask-reveal) with a
  stinger or a clean music stop. Not three CTAs.

## Size and timing numbers (all techniques)

- Hero:connector 3-6x over footage (captions), 2-3x in type-only and VO type; hero:label 9-30x in spec layouts.
- Hold ≥ 0.4 s per short word before it changes; typing ≤ 40 % of a hold. Captions on fast speech follow the voice
  instead (words can change every 0.3 s there; chunk 2-3 words so each chunk holds).
- Never more than 3 full-bleed light/dark flips per second (photosensitivity, WCAG 2.3.1), however fast the cutting.
- Overshoot ≤ 115 %; exits are cuts or the next element replacing the type.
- Type changes on percussive onsets or spoken onsets (±2 frames), not on the bare beat grid; holds are 1, 2, 4 or 8
  beats (a word ≥ 1 beat, a held lockup 4-8).
- Safe areas: 9:16 keeps type out of the top 12 % and bottom 20 %; nothing over the face.

## Sound per type event (CRAFT.md levels)

| event | sound | level |
| --- | --- | --- |
| hero word / slam / lockup | layered hit (+ sub on a slam) | -10 LUFS momentary; 3-6 dB lower under VO |
| emphasis word in captions | pop or tap, varied | -16 to -20 dB |
| typing / decode | keys or data chatter under the typing only | -20 to -26 dB per key |
| word rotator / flip | tick | -16 to -20 dB |
| mask reveal / morph / lower third | soft swish or nothing | -14 to -18 dB |
| lyric / title sequence | nothing (the song or a boom on the title only) | — |

## Gaps in this family (from `GAPS.md`)

`text-echo-stack`, `text-on-path`, `svg-path-write-on`, `cutout-title-reveal`, `tracked-point-callout-pin`,
`lyric-forced-alignment`, `type-strobe-sequencer`, `typographic-layout-variants`, `cylinder-text-wheel`. Each technique
that needs one says so and gives the fallback it was verified with.

## Four verified combinations (showcases, 2026-10-28)

Built with the CLI on bench footage, rendered, judged once with the watch judge, one fix pass from its notes, judged
again. Scores are absolute (/10). Each scene keeps to one hero motion + at most one support motion.

| edit | scenes (hero + support) | first → after fix | what the fix was |
| --- | --- | --- | --- |
| Talking head 9:16, 12 s | text-behind-subject hook → vo-captions + emphasis-scale (+ lower-third once) → keyword-slam card at 40 % → captions over inserts → mask-reveal end card | 4.3 → 6.5 | picture ended 0.5 s after the last word (no dead air), inserts on the words they show, hook word sized to fit, captions not behind the head while inserts are on |
| Launch promo 16:9, 12 s, 120 bpm | mask-reveal headline → counter → keyword-slam (black) → 3d-title → word-rotator end card | 5.0 → 6.4 | brighter accent on the serif word, footage dimmed under type, the 3D title on its own dark field instead of repeated b-roll |
| Editorial 16:9, 15 s, 108 bpm | letter-swap on a specimen sheet → hard cuts → scramble-decode labels over footage → quote-card (pattern break) → type-morph lockup | 6.6 → 7.7 | lockup held 1.4 s, shadows lifted + fine grain on the stock to meet the paper palette |
| Lyric 16:9, 9 s, 96 bpm | lyric-sync (one face, one size) → shout line + text-on-path ring → letter-cascade lockup on black | 4.6 → 4.5 | ended on the lockup, dimmed footage, one hit on the shout; still limited by the synthetic singing voice and busy concert footage |

Lessons that hold for every edit: end on a held lockup (the judge marks every abrupt end down), give type its own calm or
dark ground (stock footage under type is the most common complaint), and a sound on the hero type events is worth more
than any extra motion.
