---
id: shot-brake-scroll
kind: technique
summary: "When 'we ship constantly, this one is the big one': a long list or timeline whips past, then brakes hard on the target."
categories: [saas-app-launch, product-launch-film, video-essay-explainer, documentary-true-story]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, apply_fx_tool, add_effect_tool, add_sfx_tool]
pace: fast
mood: [dense, energetic, decisive]
aspect: ["16:9", "9:16"]
pairs_with: [shot-scan-annotate, shot-live-chart, kinetic-counter, shot-crash-zoom-punch]
avoid_with: [shot-multiplane-slider, shot-station-flythrough, cinematic-speed-ramp]
needs: []
---

# Scroll brake (vertical changelog) and timeline travel (horizontal)

## What it is
A year of updates scrolls by as a smear, then an exponential brake stops exactly on this release's entry, which lifts while the rest dims.
Density says "always shipping", the brake says "today's is the biggest". The horizontal cousin: the camera accelerates along a time axis past version
ticks (cards spring up as it passes) and brakes on the latest, pushing in 1.28x.

## Build it in Zenvi
1. A tall still of the whole list, or a long screen-recording, as one clip scaled to fill the width (taller than the frame). Row heights should vary (72 / 94 / 116 px) so the smear has rhythm.
2. Scroll with the brake curve: `set_keyframes_tool {"timeline_clip_id":"<list>","property":"location_y","mode":"replace","points":[{"seconds":0,"value":0},{"seconds":0.17,"value":-0.35,"ease":"ease_in_quad"},{"seconds":1.7,"value":-<D>,"ease":"ease_out_expo"}]}`
   where `<D>` puts the target row at screen centre (D = row centre, in frame heights, minus 0.5, times the clip scale). Variant B ("reticle lock"): overshoot 30 px past the stop and spring back (`ease_out_back` on the last 0.2 s).
3. Directional blur on the fast part only: `apply_fx_tool {"clip_id":"<list>","effects":[{"effect":"directional_blur","amount":0.8,"params":{"angle":90},"start":0.1,"end":1.2}]}` (bake it before the keyframes).
4. Landing: target row `scale` 1.0 to 1.03 and a 2 px accent outline (split the target row onto its own track as a still); the rest of the list `alpha` to 0.38 (`add_effect_tool {"effect":"Brightness","properties":{"brightness":-0.4}}` also works). Do not go to 0.
5. Horizontal travel: swap `location_y` for `location_x` on a wide strip; per-card spring-up with `apply_clip_preset_tool {"preset":"bounce_in_from_bottom"}` timed 6 frames before the camera reaches each tick; end with `scale` 1 to 1.28 in 10 f (`ease_out_cubic`).

## Timing & taste rules
- Total 4-5 s: scroll ~2400 px in 50 f, full speed within 5 f, long exponential tail. Motion blur follows speed (frame difference x 0.32, cap 30 px), clear when stopped.
- Brake variants: A pure exponential; B sin-in acceleration, cubic-out hard brake, 30 px overshoot, back to rest.
- Stop with the target dead centre vertically. Off-centre looks like an accident.
- Fast rows are unreadable by design: use grey placeholder text there; the target row must be production-quality content.
- Horizontal: speed curve breakpoints [0, 0.15, 0.88, 1] to [0, 0.055, 0.9, 1] (slow start, sprint, last 12 % brake); 3-5 major ticks plus small ticks as speed reference; spring damping ~11 with visible overshoot. Leave >= 30 f static at the end and reserve it first (plan backward).
- Use vertical and horizontal in one film at most once each, separated.

## Sound for it
Rising `riser_noise` through the fast part (-22 dB), `impact_thud` on the brake frame (-10 dB); variant B adds a `mouse_click` (-14 dB) on the same frame. Timeline travel: a light `ui_tap` per card, impact on the stop.

## Common mistakes
- Keyframing blur by hand: it never matches the speed; derive it from the scroll curve (or bake over the fast span).
- Fading the context rows to nothing.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/data/scroll-brake-moves.md` and `shots/data/timeline-travel.md` (Apache-2.0; see ../NOTICE).
