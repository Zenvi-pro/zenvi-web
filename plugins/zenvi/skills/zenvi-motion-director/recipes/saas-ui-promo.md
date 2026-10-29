---
id: saas-ui-promo
kind: style
summary: An app, AI tool or SaaS launch - glass UI cards over soft photos, prompt bar, counters, a URL end card
categories: [saas-app-launch, product-launch-film, animated-explainer]
tools: [add_motion_block_tool, apply_motion_transitions_tool, color_grade_clip_tool, auto_sound_design_tool]
pace: medium
mood: [calm, premium, optimistic]
aspect: ["16:9", "9:16"]
pairs_with: []
avoid_with: []
---
# SaaS / UI promo

Glass UI over landscape photos, big headline with a serif-italic accent,
cards that enter in depth with a stagger, a pointer that clicks and causes
something, counters, a word rotator, a URL end card. Light, calm, premium.
Reference feel: a new scene or UI state every 2-3 s, cuts on soft clicks and
whooshes, camera always drifting.

## Structure (20 s, 16:9): a new state every 2-3 s

| t (s) | scene | block |
| --- | --- | --- |
| 0-2.5 | headline lands word by word on a soft light field | `gradient_field` (`style: "aurora"`, `palette: "light"`) + `kinetic_headline` over it |
| 2.5-6.5 | connector cards rise in over the landscape, pointer clicks the toggle on | `glass_cards` full frame, plate as `background` |
| 6.5-9 | the action: a prompt types and sends | `prompt_bar` over the second plate |
| 9-11.5 | the proof: a number counts up | `counter` over the light field |
| 11.5-15 | the promise | `word_rotator` over the light field |
| 15-17.5 | the cards again in a new state, or a second glass scene | `glass_cards` (other `cards`, `click`) |
| 17.5-20 | brand and URL | `kinetic_headline` (`text: "Island Control / *islandcontrol.ai*"`) on the light field |

Text never sits straight on a busy photo: type scenes go on the light
`gradient_field`, photos sit behind glass. Hold a finished state at most
1-1.5 s, then the next thing happens.

## Tools

0. One call first: `build_product_launch_tool` (`product`, `problem`,
   `tagline`, `features` as 'Title: detail', `proof` {stat, label} or
   {quote}, `cta`, `url`, `file_ids` for the plates, `logo_file_id`). Every
   section lands on the bar: the problem, the reveal (3D title, else a
   kinetic headline block, else type) on a hit, glass cards for the features,
   a counter over a light field, the logo reveal end card; one undo step,
   each fallback in `data.decisions`. The steps below add the prompt bar and
   the second glass scene.
1. Plates: 2 landscape clips (soft, misty, lots of sky). Grade them light and
   quiet so glass reads over them: `color_grade_clip_tool` `scope: "all"`,
   `exposure: 0.3`, `saturation: 0.7`, `contrast: -0.15`; and
   `apply_clip_preset_tool` `preset: "ken_burns_in"` on each.
2. One `palette` for every block (`"light"`; `"sky"` for cool brands) and one
   `accent` from the brief or a calm deep colour (`"#1F5F4A"`, `"#2F6BFF"`),
   never the palette's default red on a calm brand. Blocks back to back on the
   track above the plates:

```json
add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 2.5,
  "params": {"style": "aurora", "palette": "light", "grain": true}}
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 0, "duration_seconds": 2.5,
  "params": {"text": "The *Control Plane* / for the Agentic Enterprise", "style": "blur", "emphasis": "serif", "palette": "light", "accent": "#1F5F4A"}}
add_motion_block_tool {"block": "glass_cards", "position_seconds": 2.5, "duration_seconds": 4, "placement": "full_frame",
  "params": {"background": "<plate file id>", "headline": "Connect *every* tool", "cards": ["GitHub", "Salesforce", "HomeOps"],
             "details": ["Connected", "Connected", "Off"], "click": 2, "status": "Connected", "accent": "#1F5F4A"}}
add_motion_block_tool {"block": "counter", "position_seconds": 9, "duration_seconds": 2.5,
  "params": {"values": ["0", "8.7"], "decimals": 1, "suffix": "M", "label": "Agent actions governed", "accent": "#1F5F4A"}}
add_motion_block_tool {"block": "word_rotator", "position_seconds": 11.5, "duration_seconds": 3.5,
  "params": {"prefix": "So your", "words": ["agents", "approvals", "writing", "planning"], "suffix": "run themselves", "size": 110}}
```

   Each block renders at ~5-10 s per second of block; `draft: true` while
   iterating, then `update_motion_block_tool` `draft: false`, `motion_blur: 4`
   on cards and headlines.
3. Transitions, on by default: once the scenes are on track 1 back to back,
   one call, `apply_motion_transitions_tool` `{"track": "1", "style":
   "cinematic", "direction": "left"}` (slide and blur dissolve, the last cut
   a zoom-through); or one kind, `preset: "blur_dissolve"` (0.33 s) or
   `"slide"`. Never a crossfade, never hard cuts between whole scenes.
4. Sound: `auto_sound_design_tool` `intensity: "normal"`, then `add_sfx_tool`
   per UI event: `mouse_click` on the click (in `glass_cards` at ~55 % of the
   block; check the frame), `toggle` right after it, `typing_burst` for the
   prompt, `ui_tap` on each card entrance (`gain_db: -16`), `swish_airy` on
   each scene change. Music: minimal tech with a clear pulse (not ambient
   pads), at full level, no ducking.

## Without motion blocks (web editor, Zenvi Cloud)

`build_reel_tool` `style: "ui_promo"` with `hook`, `labels`, `words`,
`end_card`, or single `add_motion_template_tool` templates (`type_search`,
`ui_cards` with `button`, `word_scroll`, `end_card` `variant: "logo"`), all
with `palette: "ui_light"` and `font_family: "inter"`.

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 4 above (`intensity: "normal"` plus the UI sounds).
2. `master_audio_tool` `{"preset": "social", "genre": "saas_ui", "iterate": true}` (fixes what analyze_mix_tool finds, then masters), after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

## Checks

Contact sheet: every 2-3 s a different composition, no type on a busy photo. `preview_frame` at each
block's entrance end: headline inside title-safe and not touching cards;
pointer on the toggle at the click; counter's last value readable; end card
centred with the URL legible (≥ 36 px at 1080).

## Pitfalls

- One static UI screenshot for 5 s, or a number held 2 s after it lands:
  something must happen every second.
- Saturated green plates under dark text: the reference plates are pale and
  soft (bright, low saturation).
- Three accent colours: one accent, the palette's neutrals.
- The serif accent on every headline: once or twice per piece.
- Generic copy ("Revolutionize your workflow"): use the brief's nouns.
