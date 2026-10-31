---
id: kinetic-lyric-sync
kind: technique
summary: "When a song's words are the text: lyrics appear on vocal onsets, one face, one size, a shout line in caps."
categories: [music-lyric-video, kinetic-type-motion-design, fashion-beauty-ad, travel-cinematic-montage]
tools: [kinetic_captions_tool, add_kinetic_title_tool, detect_beats_tool, edit_captions_tool]
pace: medium
mood: [emotional, rhythmic, intimate]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [kinetic-text-on-path, kinetic-title-sequence]
avoid_with: [kinetic-vo-captions, kinetic-karaoke, kinetic-emphasis-scale, kinetic-scramble-decode]
needs: [lyric-forced-alignment]
---

# Lyric text timed to vocals

## What it is
Lyric words or phrases appear at the sung onsets: lowercase subtitle lines with one caps shout line, a serif block with
4-frame fades, or a monospace stanza that snaps. Emphasis comes from timing and layout, not size.

## Build it in Zenvi
ASR on sung vocals is unreliable and there is no forced aligner (`needs: lyric-forced-alignment`). Fallback: hand-time
one cue per sung phrase (listen, or read onsets from `detect_beats_tool` / the waveform) and pass them as cues:
```json
kinetic_captions_tool {"cues": [{"text": "we were lights", "start": 0.4, "end": 1.6}, {"text": "in the dark", "start": 1.9, "end": 2.9},
  {"text": "WE WERE LOUD", "start": 3.2, "end": 4.6}], "style": "editorial", "animation": "fade", "emphasis": "none", "text_size": 0.075, "placement": "style"}
```
A phrase per cue; words inside it are spread by length. Pass `placement: "style"`: with the default `auto` the CLI
first mattes the footage to keep words off the subject (on 2026-10-28, under heavy load, 20+ minutes for 7 s of concert
footage) — lyric layout is decided by hand anyway. `style: "editorial"` for a serif block, `"stack"` for a shout.

## Timing & taste rules
- Cue onset within 2 frames of the sung onset; hand-timed cues are checked by ear on a render. `detect_beats_tool`
  gives music beats, not sung words, so use it only to find candidate onsets. Words inside a phrase cue are spread by
  length, not by the voice: when each word must land on its own onset, give each word its own cue.
- One face, one size (≤ 1.2x variance); only the shout line may be bigger/caps.
- Reset the canvas in the vocal rests (on the breath), not mid-line.
- Keep the lyric off the focal subject (bottom band, above the horizon, or beside the singer), on a calm dark area:
  thin serif or small Inter over flashing stage lights is unreadable (judged 2.9-3.0 in the test).
- Second layer of motion (families/kinetic.md rule 2): while the type holds, the picture keeps moving — push the
  footage or backdrop 1.0 → 1.06 over the shot with `set_keyframes_tool` on that clip (not on the title clips).

## Sound for it
None: the song is the mix (cue-per-cut under ~10 %). Do not run auto_sound_design at its default density.

## Common mistakes
- Captions from ASR on a song (wrong words, drifting timing).
- Pop/slam entrances on a ballad.
- Copying a real song's lyrics into a public edit.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-lyric-sync.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-lyric-sync.mp4` and its contact sheet. Checked on the sheet: three hand-timed cues on a sung line from the macOS 'Good News' voice, each phrase fading in on its onset, the shout line in caps. Small documentary Inter (first try) and the thin serif at 0.075 (second) both struggled over the busy concert lights: lyrics need a calm part of the shot or a dark band, which the showcase uses. Watch judge (absolute, isolated 3-5 s test): **2.9/10** overall, typography 4; its main note: "The thin white serif typeface gets lost in the crowd silhouettes and dark background clutter.".
