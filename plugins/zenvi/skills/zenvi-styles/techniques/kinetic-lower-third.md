---
id: kinetic-lower-third
kind: technique
summary: "When a speaker or place needs a name: a rule draws on, name rises out of it, role drops under, then exits."
categories: [documentary-true-story, podcast-clip-vertical, brand-story-corporate, news-short-vertical-explainer, talking-head-captions, tech-review, real-estate-tour]
tools: [add_motion_block_tool, add_title_tool, add_sfx_tool]
pace: calm
mood: [professional, credible, clean]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-vo-captions, kinetic-mask-reveal, kinetic-quote-card]
avoid_with: [kinetic-karaoke, kinetic-echo-stack]
needs: []
---

# Lower third

## What it is
A name and role hung from the left (or right) title-safe edge: an accent rule draws across, the name rises out of it,
the role drops under; on exit both keep travelling the way they came while the rule wipes away.

## Build it in Zenvi
```json
add_motion_block_tool {"block": "lower_third", "position_seconds": 0.8, "duration_seconds": 4.2,
  "params": {"name": "Rae Okafor", "role": "Product designer", "style": "rule", "align": "left", "palette": "dark", "accent": "#f2c14e"}}
add_sfx_tool {"recipe": "swish_airy", "at_seconds": 1.0, "gain_db": -18}
```
`style: "bar"` wipes a solid accent bar behind the name (news, podcast). Native/desktop: `add_title_tool` with a
lower-third template (`list_title_templates_tool`), `text: "Name\nRole"`.

## Timing & taste rules
- First appearance of the speaker, 0.5-1 s after they start talking; 3-5 s on screen; never again for the same person.
- Name 4-5 % of frame height, role 55-65 % of the name; on 9:16 keep it above the bottom 20 % UI band.
- Never at the same time as captions in the same zone: move captions up or wait.

## Sound for it
A very soft swish (-18 dB) or nothing under speech.

## Common mistakes
- Lower third over the speaker's hands/mic or under the platform UI.
- Fictional names only in tests; in a real edit, the user's spelling of the name.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-lower-third.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-lower-third.mp4` and its contact sheet. Checked on the sheet: accent rule, name and role rise in on the left title-safe edge and exit the way they came; name about 4 % of frame height. Watch judge (absolute, isolated 3-5 s test): **4.6/10** overall, typography 6; its main note: "Completely silent video with zero audio or sound design.".
