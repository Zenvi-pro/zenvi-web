---
id: shot-voice-input-pill
kind: technique
summary: "When 'talk to it' is the feature: a glass dictation pill types a sentence as its light fades, or a waveform listens."
categories: [saas-app-launch, product-launch-film, tech-review, animated-explainer]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [quiet, luminous, tactile]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [shot-type-and-filter, kcut-draw-on]
avoid_with: [shot-canvas-materialize]
needs: [live-waveform-bars]
---

# Voice input pill

## What it is
Two takes on "it is listening". A dictation pill pops in slightly large, settles, a warm light inside it fades as the sentence types in (the light gives
way to text). Or a recording capsule whose 64 thin bars rise while you speak, shrink to dots in the pauses and scroll right to left, ending in a send.
The quietest beat of a launch reel.

## Build it in Zenvi
Pill and typing: the liquid-glass block is a frosted pill with refraction over a plate:
```json
add_motion_block_tool {"block": "liquid_glass", "params": {"scene": "dunes", "text": "Plan a weekend trip to Lisbon", "results": [], "frost": 0.6, "bend": 40},
  "position_seconds": 0, "duration_seconds": 4.0, "placement": "full_frame"}
set_keyframes_tool {"timeline_clip_id": "<pill_clip>", "property": "scale_x", "ease": "ease_out_quart", "points": [{"seconds": 0, "value": 1.25}, {"seconds": 0.67, "value": 1}]}
```
(repeat for `scale_y`; `alpha` 0 -> 1 in the first 2 frames so it is "there" before it lands). The inner warm light fading is not a parameter
there: lay a warm `gradient_field` (style orbs, one apricot colour) under the pill and key its clip's `alpha` 1 -> 0 over the typing window.
Live waveform (`needs: live-waveform-bars`): no bar-equaliser block; nearest are `kcut-draw-on` (a traced waveform) or an audio-driven bars still. If the
film has a real voice track, a traced waveform must follow it; a synthetic envelope is only for music-only films.

## Timing & taste rules
- Pill 1.25x -> 1.0 in 20 frames (0.67 s), strong ease-out, blur 6 px -> 0 while landing; fixed width (it must not grow with the text).
- Type at 2 frames per character, constant (dictation is not hesitant); cursor appears 2 frames early, leaves at ~2.3 s.
- The light fades over the same window as the typing (10 -> 72 frames), and the ambient glow behind the pill fades with it, or the fade is invisible on light grounds.
- Bars: 64, gap 5 px, a roughly 820 px wide field; speak 1.4 s, pause 0.8 s (bars clamp to 6 px dots), speak 1.4 s, send with a 12-frame collapse to 6 %.
- Waveform scrolls at 1.6 frames per sample; fewer than 40 bars reads as an equaliser, more than 90 loses each bar.
- Keep the idle breathing under +-2.4 px; larger reads as recording.

## Sound for it
Nothing under the typing but a faint `keyboard_key` run if the film allows; a `pop` (-14) on send and a short falling `whoosh_fall` for the collapse. With a voice-over,
the bars follow the voice and the voice is the sound.

## Common mistakes
- Waveform that follows the music instead of the speech (it is a product feature, not a visualiser).
- Pill that resizes as the text grows.
- Animating more than appear, type and fade: any extra move ruins the pause.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/interaction/glass-pill-dictation-typing.md` and `shots/interaction/voice-waveform-live.md` (Apache-2.0; see ../NOTICE).
