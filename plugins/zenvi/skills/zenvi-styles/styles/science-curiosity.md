---
id: science-curiosity
kind: style
summary: "For nature or space curiosity: rule first, equal proof steps, one snapping readout, late quiet music."
categories: [science-curiosity]
tools: [gather_stock_footage_tool, add_clip_to_timeline_tool, set_keyframes_tool, apply_motion_transition_tool, add_title_tool, add_kinetic_title_tool, kinetic_captions_tool, generate_tts_and_add_to_timeline_tool, add_sfx_tool, set_track_role_tool, set_audio_gain_tool, automate_volume_tool, duck_under_speech_tool, master_audio_tool, review_render_tool]
pace: medium
mood: [wonder, curious, calm]
aspect: ["16:9", "9:16"]
pairs_with: [t009, t014, t067, t007, t092, t074, t119]
avoid_with: [t122, t056, t125, t060]
needs: [log-zoom-scale-chain, scale-ladder-hud]
---

# Science / curiosity

Wonder built on a rule: a human-scale anchor or a one-line claim, the rule stated within the first 16% ("10x
farther every 10 s", "speed one day up to four seconds"), then equal steps that each reuse the rule, one
readout that snaps at every step, proof shots held long enough to see (4-6 s), and the payoff image alone on
black. Music enters late and quietly; sound marks ideas, not cuts. A music-driven cosmic montage variant (t074)
exists for 12-25 s social edits.

## When to use / not

- Use for: scale journeys (atoms to galaxies), slow processes made visible (growth, erosion), a surprising fact
  about nature, the body, space.
- Not for: news (news-short), opinion (video-essay), product science claims you cannot verify.

## Structure

| length | anchor / claim | rule | equal steps | payoff alone | end |
| --- | --- | --- | --- | --- | --- |
| 15 s | 0-1.5 s | 1.5-3 s | 3-12 s (3 x 3 s) | 12-14 s | 14-15 s |
| 30 s | 0-2 s | 2-5 s | 5-25 s (4-5 steps) | 25-28.5 s | hold to 30 s |
| 60 s | 0-3 s | 3-10 s | 10-55 s (6 x 7.5 s) | 55-59 s | 59-60 s |
| 90 s | 0-3 s | 3-14 s | 14-85 s (7 x 10 s) | 85-89 s | 89-90 s |

Montage variant (12-25 s, music-led): hook diagram or flash 0-1.2 s, build of match cuts micro to macro,
drop at about 50% with letterbox/colour, hard stop with 1 s on the last image.

## Shot plan

Proof shots 4-6 s (macro time-lapse, microscope, space), each step the same length; one move per shot (push or
tilt, 5-8%); round subjects centred and matched in size across steps (match cuts); speaker or host on screen for
the thesis and the last line only (at most about 45% of cuts).

## Look & grade

Natural grade for people and places, saturation allowed to spike only on CGI or micro imagery; one saturated
element per frame. Black for the payoff. Thin white mono readouts.

## Type system

One readout at about 4% height, mono, fixed corner, snaps per step (t067). The rule in an editorial serif line
once (`add_kinetic_title_tool` `style: "editorial"`); captions small (documentary style) or none.

## Motion & transitions

Zoom-through or match cuts between scale steps (t014), constant rate; hard cuts elsewhere; no flashes or glitch
except in the montage variant. Every push eased.

## Sound & music

- Music: ambient pad or space pulse; the opening is dry (VO alone), the bed enters at about 25-30% with the first
  proof, swells once at the big reveal; 12-20 dB under the voice.
- Levels: voice -15 LUFS; master -14 LUFS (social) or -16 (long-form).
- Cues: about 2-4 per minute (a whoosh per scale jump, a reverse swell into the reveal, a tick on the readout);
  montage variant 16-30 per minute.

## Captions/VO

Calm, curious VO about 150-165 wpm with pauses that let the proof play; the narrator names what appears. Short
documentary captions or none on 16:9; captions on 9:16.

## Tool sequence

1. VO per line (`generate_tts_and_add_to_timeline_tool`, `voice: "sage"` or the user's read), `set_track_role_tool`.
2. Proof footage: `gather_stock_footage_tool` `{"queries": ["seedlings growing time lapse", "flower blooming time lapse",
   "microscope cells", "plant leaf macro"], "min_seconds": 5}`.
3. Place each step on its line with equal lengths: `add_clip_to_timeline_tool`; `set_keyframes_tool` scale 1.0 to
   1.07 per shot (`ease_in_out`).
4. Scale steps: `apply_motion_transition_tool` `{"preset": "zoom_through", "time": <join>}` + `add_sfx_tool`
   `whoosh_short` (-16).
5. Readout per step: `add_title_tool` `{"template": "Header_3", "text": "10⁻⁴ m", "font": "Menlo",
   "text_color": "#ffffff", "position_seconds": <step>, "duration_seconds": <step length>}`.
6. The claim: `add_kinetic_title_tool` `{"text": "Plants move.", "style": "editorial", "animation": "rise",
   "emphasis": ["move."]}`; captions after it: `kinetic_captions_tool` `{"style": "documentary"}`.
7. Late bed: music clip starting at the first proof, `set_audio_gain_tool` -22, `automate_volume_tool`
   `fade_in` 2500 ms; `add_sfx_tool` `reverse_swell` into the reveal.
8. Payoff alone, then `master_audio_tool` `{"preset": "social", "iterate": true}`, render, `review_render_tool`.

## Finish checklist

1. The rule appears within the first 16% and every step reuses it at the same interval.
2. One readout, one change per step, snapped, about 4% height.
3. Proof shots 4-6 s (not all under 2 s).
4. Footage full frame; speaker on screen for at most about 45% of cuts.
5. Dry opening; bed enters late, 12-20 dB under the voice.
6. Cues at ideas (2-4/min), not on every cut (montage variant excepted).
7. Match cuts match shape and size, not just theme.
8. Natural grade; saturation only on the one CGI/micro element.
9. Reveal and music hit within a few frames of each other.
10. Clean ending: payoff image alone with the last readout; no abrupt cut-off.

## Mix-and-match

- Borrow: t009 (time-lapse proof), t014 (scale ladder), t067 (decade readout), t007 (globe take), t092 (calm
  labels), t074 (montage variant), t119 (one slam for the fact, sparingly).
- Never: kids pop cards (t122, t056), staccato slam lists (t125), news hook cards (t060).

## Reference moments

Local only (`~/zenvi-motion/refs2/science-curiosity/`): `powers-of-ten-1977@2` rule then equal 10 s steps,
`powers-of-ten-1977@12` decade readout snap, `powers-of-ten-1977@72` payoff alone, `1969@17` macro time-lapse
proof (order only, Gemini clock drifts), `1969@43` data trace on a globe. Owner reels in the dossier:
`Dc_2Y1qI0ZH@1.3` spiral match chain, `DdNDNt0PxMb@11.9` drop with letterbox.

## Verified

2026-10-28. Example edit (16 s): `~/zenvi-motion/fleet/artifacts/sk1-knowledge/styles/science-curiosity/example.mp4` (contact sheet and `calls.json` next to it), built with
`zenvi call` on the portable CLI from Pexels stock and a macOS `say` voice (`scripts/` in the same folder).
Watch judge (absolute, gemini-3.8-flash): 4.82/10 overall; its first note: "Serif title clashes with tiny plain sans-serif captions." (at 1.0 s).
Calls that failed on this surface: `apply_motion_transition` (Error: No cut on track 1000000 near 10.88s (cuts at 3.90, 8.37, 9.97, 11.67s).); `add_title` (Error: Invalid arguments for add_title_tool: 0 is less than the minimum of 0.01 (at durati); `add_title` (Error: Invalid arguments for add_title_tool: 0 is less than the minimum of 0.01 (at durati); `add_title` (Error: Invalid arguments for add_title_tool: 0 is less than the minimum of 0.01 (at durati).
Pairwise against the category's reference segment (same length): winner cand (passes ['cand', 'cand']) cand 5.68 vs other 3.91 $0.0106.
