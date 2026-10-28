---
id: saas-app-launch
kind: style
summary: "For an app, AI tool or SaaS launch reel: hook claim, typed prompt, UI that acts, one proof number, one lockup."
categories: [saas-app-launch]
tools: [set_project_setting_tool, gather_stock_footage_tool, search_freesound_music_tool, import_stock_media_tool, add_motion_block_tool, update_motion_block_tool, add_kinetic_title_tool, color_grade_clip_tool, apply_clip_preset_tool, apply_motion_transitions_tool, apply_motion_transition_tool, add_sfx_tool, auto_sound_design_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: medium
mood: [clean, confident, light, premium]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [T116, T057, T110, T045, T127, T005, T061, T086, T066, T050, T052]
avoid_with: [T021, T105, T084, T023]
needs: []
---

# SaaS / app launch

A short reel where the interface is the hero: a claim or problem hooks in
the first 3 s, a prompt types and something happens, the UI acts (cards,
toggles, a chart), one proof lands, and the logo closes on a hit with the
music stopping. Something changes every 1-3 s and every UI event clicks.

## When to use / not

Use for: product launches of apps, AI tools, developer tools, dashboards,
"announce our feature", "launch video for my startup". Not for: hardware
(`product-launch-film`), a tutorial or walkthrough with narration
(tutorial recipe), a founder story (`brand-story-corporate`), a review.
With VO, keep the structure and duck the bed; captions only in creator
style (9:16).

## Structure (beats with timings)

Problem-first (pain, "but what if", product) or cold-open on the prompt;
both end on one lockup.

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Hook: claim, problem line or the prompt already typing (no logo) | 0-2 | 0-3.5 | 0-7 | 0-10 |
| Setup: "what if" pivot, the giant word (T116) | 2-4 | 3.5-8 | 7-15 | 10-20 |
| Demo: prompt types, result generates, UI acts, 1-3 s per state | 4-9 | 8-19 | 15-38 | 20-58 |
| Proof / range: one number or chart, use cases, logos | 9-12 | 19-25 | 38-50 | 58-76 |
| Payoff: cut speed-up into one tagline | 12-13.5 | 25-27 | 50-55 | 76-82 |
| Lockup: logo/URL held 1.5-4 s on a hit, music stops | 13.5-15 | 27-30 | 55-60 | 82-90 |

## Shot plan

- Mostly motion-design scenes (`add_motion_block_tool`), each 2-4 s with
  something happening inside it; hold a finished state at most 1-1.5 s.
- Hybrid reels add live inserts (hands on a keyboard, a face reacting, a
  coffee) of 0.6-1.5 s between UI shots to reset attention.
- Backdrops: a light `gradient_field` for type, pale soft landscape plates
  behind glass (T057), or a dark obsidian field for a premium dark mode.
  Never type straight on a busy photo.
- Screen captures under 1.6 s stay still; longer ones push in 100 → 108 %.

## Look & grade

- One mode for the piece: light/airy (luma > 130) or dark (luma < 100).
  A white card inside a dark piece reads as a break.
- One accent hue on neutrals (brand colour, else a calm deep colour such
  as `#2F6BFF` or `#1F5F4A`); never the palette's default red on a calm brand.
- Clean digital, no grain. Plates behind glass: `color_grade_clip_tool`
  exposure 0.3, saturation 0.7, contrast -0.15, plus `ken_burns_in`.
- Glow/bloom only in the dark premium mode, on CTA pills and screens.

## Type system

- Neo-grotesque sans (Inter) everywhere; mono (JetBrains Mono) for prompts
  and code; a serif italic accent (Instrument Serif) once or twice per piece.
- Statement text 4-7 % of frame height; hero words 10-25 % (3-9x the
  connector text, T116); UI microcopy ≥ 2.5 % (≥ 4 % for a typed prompt).
- Every text element enters with motion (rise, blur, pop, typewriter) and
  leaves cleanly; nothing static for over 3 s.
- Spell-check every string; use the brief's nouns, never "Revolutionize
  your workflow".

## Motion & transitions

- Scenes move into each other: `apply_motion_transitions_tool` `style:
  "cinematic"` (slide and blur dissolve, last cut a zoom-through) or one
  preset (`blur_dissolve`, `slide`); one direction (left).
- Zoom-through (T110) is the signature, at 1-3 section changes; white
  flash into a light card optional. Designed transitions on < 15 % of cuts
  in hybrid reels; between whole motion scenes, always a move, never a
  crossfade.
- Cards enter staggered by 2-3 frames; the pointer click scales to ~90 %.
- A 4-6 frame strobe on a drum fill (T045) at most once.

## Sound & music

- Music: tech-house / minimal electronic, 115-140 bpm, sparse for the first
  5-7 s, groove at the setup, fill into the payoff, **stop dead on the logo
  hit**. Cuts land on onsets (~70 %), not the grid.
- A sound on every UI event: keystrokes while typing, click on send, toggle,
  pop per card landing, whoosh on each transition, riser under a chart draw,
  hit or sub drop on the lockup (T086). 18-45 cues per minute.
- Levels (CRAFT.md SaaS palette): music-led bed -14…-16 LUFS; UI clicks
  18-22 dB under the hero; hero hit momentary ~-11 LUFS; no heavy subs or
  cinematic booms except the lockup. With VO: voice -15 LUFS, bed 8-12 LU under.
- `auto_sound_design_tool` `genre: "saas_ui"` covers transitions and
  block events; add the clicks and typing it cannot see. Master
  `genre: "saas_ui"`, -14 LUFS, ≤ -1 dBTP.

## Captions/VO

- 2 of 3 launch reels have no VO: typed lines narrate. With VO: 135-140 wpm,
  calm, dry, centred; no captions in 16:9 brand mode; creator 9:16 mode uses
  word-pop captions at 7-8 % height (`kinetic_captions_tool`).

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 1080, "fps": 30}
gather_stock_footage_tool {"queries": ["misty green hills aerial soft light", "calm lake mountains morning haze"], "count": 3, "orientation": "landscape", "min_seconds": 8}
search_freesound_music_tool {"query": "minimal tech house groove", "min_seconds": 35}
import_stock_media_tool {"source": "freesound", "sound_id": "<id>", "preview_url": "<url>", "position_seconds": 0, "start_seconds": 0, "duration_seconds": 30, "track": "5"}
color_grade_clip_tool {"timeline_clip_ids": ["<plates>"], "exposure": 0.3, "saturation": 0.7, "contrast": -0.15}
```

Scenes back to back on track 1 (draft while iterating):

```json
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 0, "duration_seconds": 3.5, "draft": true,
  "params": {"text": "Your releases / ship *themselves*", "style": "blur", "emphasis": "serif", "palette": "light", "accent": "#2F6BFF"}}
add_motion_block_tool {"block": "prompt_bar", "position_seconds": 3.5, "duration_seconds": 4.5, "placement": "full_frame", "draft": true,
  "params": {"prompt": "Draft the release notes from this week's merges", "status": "Generating…", "palette": "light", "cursor": true, "accent": "#2F6BFF"}}
add_motion_block_tool {"block": "glass_cards", "position_seconds": 8, "duration_seconds": 4.5, "placement": "full_frame", "draft": true,
  "params": {"background": "<plate file id>", "headline": "Every repo, *connected*", "cards": ["Billing API", "Mobile app", "Docs site"], "details": ["Ready", "Ready", "Review"], "click": 2, "status": "Shipped", "accent": "#2F6BFF"}}
add_motion_block_tool {"block": "toggle_panel", "position_seconds": 12.5, "duration_seconds": 3.5, "draft": true, "params": {"palette": "light", "accent": "#2F6BFF"}}
add_motion_block_tool {"block": "chart_build", "position_seconds": 16, "duration_seconds": 4, "placement": "full_frame", "draft": true,
  "params": {"kind": "line", "title": "Release time, hours", "values": ["30", "22", "14", "6", "2"], "labels": ["W1", "W2", "W3", "W4", "W5"], "highlight": 4, "suffix": "h", "palette": "light", "accent": "#2F6BFF"}}
add_motion_block_tool {"block": "word_rotator", "position_seconds": 20, "duration_seconds": 4, "draft": true,
  "params": {"prefix": "Ship", "words": ["faster", "calmer", "together", "today"], "size": 120, "palette": "light", "accent": "#2F6BFF"}}
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 24, "duration_seconds": 2.5, "draft": true,
  "params": {"text": "Release notes, *written*", "style": "pop", "palette": "light", "accent": "#2F6BFF"}}
add_motion_block_tool {"block": "logo_reveal_end", "position_seconds": 26.5, "duration_seconds": 3.5, "draft": true,
  "params": {"brand": "<Brand>", "cta": "Try it free", "url": "<brand>.com", "palette": "light", "accent": "#2F6BFF"}}
apply_motion_transitions_tool {"track": "1", "style": "cinematic", "direction": "left"}
```

Then `update_motion_block_tool` `draft: false` on each block (`motion_blur: 4`
on headlines and cards). Sound:

```json
auto_sound_design_tool {"genre": "saas_ui", "intensity": "normal"}
add_sfx_tool {"recipe": "typing_burst", "at_seconds": 4.1, "duration": 1.8, "align": "start", "gain_db": -16}
add_sfx_tool {"recipe": "mouse_click", "at_seconds": 6.4, "gain_db": -12}
add_sfx_tool {"recipe": "toggle", "at_seconds": 10.6, "gain_db": -14}
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 19.5, "duration": 3, "gain_db": -16}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 26.5, "gain_db": -8}
add_sfx_tool {"recipe": "sparkle", "at_seconds": 26.7, "gain_db": -16}
master_audio_tool {"preset": "social", "genre": "saas_ui", "iterate": true}
review_edit_tool {}
```

`chart_build` counts its big number *up* to the highlighted value: chart
a metric that rises (hours saved, deploys a week), not one that falls.
Over a bright plate, `glass_cards`' white headline needs a darker or
warmer plate (exposure 0, not +0.3). Read each block's click and typing times off its frames (`preview_frame`)
before placing the sounds; the times above are this layout's. The music
clip ends at the lockup hit (trim it there, or `fade_out` 0.3 s).
Render, `review_render_tool`, one fix pass.

## Finish checklist

- [ ] No cut or UI landing without a sound within 2 frames; typing is audible.
- [ ] Typed text ≥ 4 % of frame height, caret visible, finished text held ≥ 1 s.
- [ ] Every text element moves in; nothing static over 3 s.
- [ ] Hero word 3-9x the connector text at least once.
- [ ] Designed transitions at section changes, one direction, 2-3 kinds.
- [ ] One grade mode, one accent; no white card in a dark piece.
- [ ] Exactly one end card held 1.5-4 s on a hit; music stops there.
- [ ] Every string spell-checked; the brief's nouns, no stock tagline.
- [ ] -14 LUFS, true peak ≤ -1 dBTP.

## Mix-and-match

Borrow: T116 giant word, T066 prompt bar hero, T057 glass over nature,
T110 zoom-through chain, T052 chart draw, T050 counter, T045 strobe once,
T127 strobe text stack, T005 perspective UI plane, T086 cue per UI event,
T061 lockup. Never: T021 dark headlight tease, T105 black-to-white jump,
T084 dead music stop mid-piece, film grain, whip-pan chains, a whoosh on
every plain cut of a hybrid reel.

## Reference moments

Local only, in `~/zenvi-motion/refs2/saas-app-launch/`: `stripe-s27-sizzle`
(event sizzle; 4-frame strobe on a fill 17.1 s, isometric tile wave 63.4 s,
chart draws with risers 67.2 and 74.8 s, zoom-through into the lockup and
hard stop 85.5 s); `linear-ai-hero` (silent dark loop; tilted UI planes,
6-10 s slow dolly, 0 s). Owner reels named in the dossier: giant opening
word at 1.0 s and glass UI on landscape at 33.5 s (an AI-agent launch),
strobe text stack at 6.8 s (two creator demo reels), crash zoom at 1.7 s.

## Example (verified 2026-10-28)

20 s, six blocks back to back over one pale landscape plate, `cinematic`
transitions, `saas_ui` sound and a CC0 groove (`~/zenvi-motion/fleet/artifacts/sk2-product-brand/styles/saas-app-launch.*`).
Watch judge 7.9/10 absolute ("immaculate modern SaaS motion design ...
punchy UI sound design"). Its fixes: the chart counter counted up while the
line fell (rule added above), a white headline low on contrast over misty
sky, one abrupt chart → rotator cut.
