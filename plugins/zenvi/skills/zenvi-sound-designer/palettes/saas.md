# SaaS / UI promo (glass cards, prompt bars, cursors, toggles)

Design: `auto_sound_design_tool` `{"genre": "saas_ui"}` - block events
(clicks, toggles, typing, counter ticks, card lands, logo reveal) are on the
sheet from the blocks themselves.
Score / master: `"genre": "saas_ui"`.

- Every UI state change has a soft click or toggle; the typed prompt types
  audibly; cards pop; camera zooms get soft whooshes; the logo or URL gets a
  gentle hit plus a shimmer. 1.5-3.5 cues/s, mostly micro.
- Levels: UI 18-22 dB under the hero, micro sounds -6…+3 dB against the bed
  (audible on a phone); hero momentary about -11 LUFS. Light electronic or
  house bed, music-led.
- Space: a small dry room (`space_tool` `{"role": "sfx", "space": "room"}`
  only if the design sounds dry and scattered).
- Avoid: heavy subs, cinematic booms, harsh 3-5 kHz clicks above -18 dB
  (fatigue), a click on a block's edge when the block already clicks.
