---
id: cin-cam-breathing-zoom
kind: technique
summary: "When one framing carries a dashboard act: pull back after a reveal, coast, then push slowly onto the next interaction."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, screen_zoom_follow_tool]
pace: calm
mood: [breathing, fluid, assured]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-cursor-flyover, cinematic-push-in, cin-cam-pull-lands-event]
avoid_with: [shot-brake-scroll]
needs: []
drawn: cinetic
---

# Breathing zoom between interactions

cinetic `cam-breathing-zoom` · Camera · workhorse · energy calm · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

After a reveal the camera slowly pulls back, coasts through a stop and turns smoothly into a slow push that lands on the next interaction, so the frame breathes across a whole act.

Use when: Dashboard, analytics or table acts of 4-10 s with several interactions in one framing, where cutting would cost orientation.

## Build it in Zenvi

1. On the screen recording of the act (4-10 s) set the zoom as keyframes crossing zero speed, not a pose sequence: `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <s0>, "value": 1.0}, {"seconds": <s0+1.2>, "value": 0.915, "ease": "ease_in_out_sine"}, {"seconds": <s0+1.8>, "value": 0.94, "ease": "ease_in_out_sine"}, {"seconds": <s0+2.8>, "value": 1.0, "ease": "ease_in_out_sine"}]}`, the same on `scale_y`. That is a pull of about -9 % over 72 f (1.2 s), a turn, then a push building to +0.14 %/f over 36 f and about +6 % within 60 f of the zero crossing.
2. Pivot on the element the next interaction touches, so it holds its screen position: `origin_x` / `origin_y` at that element (e.g. 0.62, 0.40) on both properties, or counter with `location_x` / `location_y` keyframes of the same timing.
3. Alternative in one call: `screen_zoom_follow_tool {"clip_id": "<screen>", "zoom": 1.06, "ease": "ease_in_out_sine", "min_hold": 1.2, "cursor": true}`.
4. Close the act with an exhale under the final hold: `{"seconds": <T>, "value": 1.0}, {"seconds": <T+1.0>, "value": 0.94, "ease": "ease_out_expo"}` on `scale_x` and `scale_y`.

## Timing & taste rules

- cinetic's timing (60 fps): Pull after a reveal: -0.25%/f falling to 0 over 72 f (1.20 s) (about -9% total). Push into the next interaction: 0 rising to +0.14%/f over 36 f (0.60 s), about +6% within 60 f (1.00 s) of the zero crossing; table and list acts run +0.03 to +0.17%/f (about +6.6% total). Rate keyframes 36-90 f (1.50 s) apart, linear. Exhale x0.94 over 60 f (1.00 s) on ease_out_expo.
- Pull after the reveal: -0.25 %/f falling to 0 over 72 f (1.2 s), about -9 % in all.
- Push into the next interaction: rate rising to +0.14 %/f over 36 f (0.6 s), about +6 % within 60 f (1.0 s) of the zero crossing; table and list acts run +0.03 to +0.17 %/f (about +6.6 % total).
- Rate keyframes 36-90 f (0.6-1.5 s) apart; |rate| under 0.0002/f for at most 12 f (0.2 s): cross zero, do not rest there.
- Exhale x0.94 over 60 f (1.0 s) on an ease-out.
- Acts of 4-10 s with several interactions in one framing.

## Sound for it

None for the camera; the interactions inside keep their own clicks.

## Common mistakes

- Shots shorter than ~90 f (1.5 s), acts that already move pose to pose, or a scrolling feed (avoid_when).
- A rate that rests at zero: the shot then feels locked.
- A pivot that is not the next interaction: the element drifts away as the zoom pushes.
- Avoid when: Shots shorter than about 90 f, acts that already move pose to pose with big pushes, or a scrolling feed (a zoom on a moving list reads as wobble).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-breathing-zoom`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
