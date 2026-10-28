# Kinetic type family — how the `kinetic-*` techniques combine

Read this after the style is chosen and before placing any type. The style file says *what* the edit says; this file
says which type motions carry it, and which never share a scene.

## The two rules

1. **Never more than two type motions per scene** (a scene = one shot or one card, or 2-4 s of edit). One is the hero
   motion (the thing the eye follows), the other is support (a caption, a label, a lower third). A third motion makes
   the viewer read the animation instead of the words.
2. **One type system per edit**: one display face + one text face (+ mono for labels when there is data), ink, paper and
   one accent. The motions change scene to scene; the faces and colours do not.

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
- **Lockup**: one end card held ≥ 1.5 s (letter-cascade wordmark, word-rotator landing, 3d-title, mask-reveal) with a
  stinger or a clean music stop. Not three CTAs.

## Size and timing numbers (all techniques)

- Hero:connector 3-6x over footage (captions), 2-3x in type-only and VO type; hero:label 9-30x in spec layouts.
- Hold ≥ 0.4 s per short word before it changes; typing ≤ 40 % of a hold.
- Overshoot ≤ 115 %; exits are cuts or the next element replacing the type.
- Type changes on percussive onsets or spoken onsets (±2 frames), not on the bare beat grid.
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
