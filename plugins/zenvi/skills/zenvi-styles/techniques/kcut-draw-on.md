---
id: kcut-draw-on
kind: technique
summary: "When the subject has a line of its own (a signal, a circuit, a route): trace it on, then match-cut on it."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool]
pace: medium
mood: [technical, precise]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-collapse-cut, kcut-count-up]
avoid_with: [kcut-marquee-bands]
needs: [custom-trace-layer]
---

# Motif trace draw-on

## What it is
A line the subject owns drawn on with its pen head: `+scope` (graticule + a trace that swells into a wave, three strokes for phosphor glow), `+routes` (24 traces in 90°/45° runs converging on the motif, pads popping where they land). The motif shot that makes a piece pass the reskin test, and the match cut into the next shot (the waveform becomes the routes).

## Build it in Zenvi
One `kinetic_cut_scene` storyboard line per shot (grammar in `styles/kinetic-cut.md`):
```json
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "duration_seconds": 6,
  "params": {"bpm": 120, "shots": [
    "4 type quiet torque, all the way up | 85 Nm @left +scope",
    "2 mask 21 KG | carbon frame @diagonal +routes"]}}
```
Other lines (a map arc, a signature, an ECG) are not layers yet (`needs: custom-trace-layer`): use `line_trails` (generative curves) or `hud_callouts` leader lines.

## Timing & taste rules
- The trace draws in the first 0.4-0.7 s, then keeps moving (the wave animates, pads breathe).
- Put the type on the other side (`@left` / `@right`), the trace in the free half.
- Match cut: end one trace shot and open the next on the same line.

## Sound for it
A soft rising whoosh under the draw (`whoosh_rise` -18 dB), a tick on each pad (the block's cut impact covers the cut).

## Common mistakes
- A trace with no relation to the subject (a waveform for a bakery).
- Thin traces on light grounds at small sizes (they vanish in the 720p preview).

## Verified
2026-10-29, CLI (`zenvi call`, this branch) on the block alone with a generated 6 s bed: `scripts/kcut-verify.sh kcut-draw-on` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/x1-ext-skills/`, local only) → `techniques/kcut-draw-on.mp4` and its sheet. Checked on the sheet: the scope graticule and trace swell into a wave beside the typed line; the routes converge on 21 KG with pads popping. Watch judge (absolute, isolated 6 s test): **6.27/10**; main note: "The sound design supports the tech vibe decently, though the ending abruptly cuts out without a proper resolution."

Adapted from Tweenkit's kinetic-cut-video skill (MIT; see ../NOTICE).
