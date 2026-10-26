# SaaS / UI promo

Glass UI over landscape photos, big headline with a serif-italic accent,
cards that enter in depth with a stagger, a pointer that clicks and causes
something, counters, a word rotator, a URL end card. Light, calm, premium.
Reference feel: a new scene or UI state every 2-3 s, cuts on soft clicks and
whooshes, camera always drifting.

## Structure (20 s, 16:9)

| t (s) | scene | block |
| --- | --- | --- |
| 0-3 | headline lands word by word over the landscape | `kinetic_headline` (`style: "blur"`, `emphasis: "serif"`) over the plate |
| 3-7 | connector cards rise in, pointer clicks the toggle on | `glass_cards` full frame, plate as `background` |
| 7-10 | the prompt / action | `prompt_bar` over a second plate |
| 10-13 | the number that proves it | `counter` (`values`, `suffix`, `label`) |
| 13-17 | the promise | `word_rotator` (`prefix`, `words`) |
| 17-20 | the brand and URL | `kinetic_headline` or `end_card` (`variant: "logo"`) |

Scenes butt against each other on track 2+ over a landscape on track 1 that
pushes in slowly the whole time (`ken_burns_in`). Cut between blocks on the
music's bar lines.

## Tools

1. Plates: 2-3 landscape clips or AI stills ("calm green hills and a lake,
   soft light, empty sky"), `apply_clip_preset_tool` `preset:
   "ken_burns_in"` on each.
2. Blocks, back to back, all with one `palette` (`"light"` or `"sky"`) and
   one `accent` (the brand's):

```json
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 0, "duration_seconds": 3,
  "params": {"text": "The *Control Plane* / for the Agentic Enterprise", "style": "blur", "emphasis": "serif", "palette": "light"}}
add_motion_block_tool {"block": "glass_cards", "position_seconds": 3, "duration_seconds": 4, "placement": "full_frame",
  "params": {"background": "<plate file id>", "headline": "Connect *every* tool", "cards": ["GitHub", "Salesforce", "HomeOps"],
             "details": ["Connected", "Connected", "Off"], "click": 2, "status": "Connected"}}
add_motion_block_tool {"block": "counter", "position_seconds": 10, "duration_seconds": 3,
  "params": {"values": ["0", "8.7"], "decimals": 1, "suffix": "M", "label": "Events governed"}}
add_motion_block_tool {"block": "word_rotator", "position_seconds": 13, "duration_seconds": 4,
  "params": {"prefix": "So your", "words": ["agents", "approvals", "writing", "planning"], "suffix": "run themselves"}}
```

   Each render takes ~5-10 s per second of block; `draft: true` while
   iterating, `update_motion_block_tool` `draft: false` at the end.
   `motion_blur: 4` on the cards and headline for the final pass.
3. Transitions: between full-frame blocks `blur_dissolve` (0.33 s) or
   `slide` `direction: "left"`, one kind throughout; never crossfade.
4. Sound: `auto_sound_design_tool` `intensity: "normal"`, then `add_sfx_tool`
   per UI event: `mouse_click` at the click (block start + ~60 % of its
   length; check the frame), `toggle` right after it, `typing_burst` for the
   prompt, `ui_tap` on each card entrance (`gain_db: -16`), `swish_airy` on
   scene changes. Music: minimal tech at full level, no ducking.
5. Colour: blocks are designed; grade only the plates (`sunlit_cinema` at
   0.4) so the glass blur stays clean.

## Without motion blocks (web editor, Zenvi Cloud)

`build_reel_tool` `style: "ui_promo"` with `hook`, `labels`, `words`,
`end_card`, or single `add_motion_template_tool` templates (`type_search`,
`ui_cards` with `button`, `word_scroll`, `end_card` `variant: "logo"`), all
with `palette: "ui_light"` and `font_family: "inter"`.

## Checks

Contact sheet: every 2-3 s a different composition. `preview_frame` at each
block's entrance end: headline inside title-safe and not touching cards;
pointer on the toggle at the click; counter's last value readable; end card
centred with the URL legible (≥ 36 px at 1080).

## Pitfalls

- One static UI screenshot for 5 s: something must happen every second.
- Three accent colours: one accent, the palette's neutrals.
- The serif accent on every headline: once or twice per piece.
- Generic copy ("Revolutionize your workflow"): use the brief's nouns.
