---
id: shot-scan-annotate
kind: technique
summary: "When a machine should read the screen: a scan band passes, targets are framed by snapping corner brackets and named."
categories: [saas-app-launch, tech-review, product-launch-film, vfx-tutorial-breakdown, movie-game-trailer]
tools: [add_motion_block_tool, add_shape_mask_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [analytical, mechanical, cool]
aspect: ["16:9", "9:16"]
pairs_with: [shot-assemble-flyin, shot-cursor-flyover, shot-brake-scroll, kinetic-scramble-decode]
avoid_with: [shot-tilted-plane-glide, shot-slam-entrance]
needs: [reticle-bracket-overlay, scan-band-overlay]
---

# Scan and annotate (scan band, reticle lock, labels)

## What it is
The "machine's gaze". A thin light band travels across a page that is already there (the page never moves), and the item it passes is framed by four L-shaped corner brackets that fly in from outside, overshoot and snap on, then a small tag types its label. A status line counts items "00/06 to 06/06". The no-annotation cousin: a document pops in, brackets drop on its corners and a band scans back and forth five times.
Two colours: the page's own, and one "machine" colour for every scan, bracket and tag.

## Build it in Zenvi
1. The page: your screenshot or recording as the background clip.
2. Call-outs: `add_motion_block_tool {"block":"hud_callouts","position_seconds":1.0,"duration_seconds":4,"params":{"title":"ITEMS 06 / 06","labels":["LOGO","NAV","HEADLINE","CTA","HERO","PALETTE"],"values":["mark","links","H1 96 px","primary","image","5 colours"],"points":[{"x":0.1,"y":0.08},{"x":0.5,"y":0.08},{"x":0.3,"y":0.3},{"x":0.3,"y":0.55},{"x":0.72,"y":0.45},{"x":0.5,"y":0.88}],"grid":"none"}}` (anchor rings + leader lines + decoding labels).
3. Scan band (approximate): a thin high-contrast bar still on top, `set_keyframes_tool property=location_y` linear (no easing) over 74 f; blur the trail via baked `directional_blur`.
   Trigger each label when the band passes the target's lower edge: `t_i = t0 + (y_i + h_i - y0) / (y1 - y0) * (t1 - t0)`; keep >= 4 f between triggers.
4. Brackets (missing as a tool; `needs: reticle-bracket-overlay`): use 4 corner stills with `apply_clip_preset_tool {"preset":"back_in_from_left"}` etc. pointing inward and a `set_keyframes_tool` scale 2.2 to 0.94 to 1 over 8-10 f; a quick local brighten via `add_shape_mask_tool` `rectangle` at the target with `keyframes` on `grow`.
5. Tag: `add_kinetic_title_tool {"text":"HEADLINE","style":"documentary","animation":"typewriter","text_size":0.03}` appears 5 f after lock.
6. Close with a status chip: `add_kinetic_title_tool {"text":"SCAN DONE","animation":"scramble"}`.

## Timing & taste rules
- Scan 74 f strictly linear: any easing reads as someone dragging a progress bar. Under 60 f the tags pile up. 150 f (5 s) total, ~60 f of final hold.
- Label appears 5 f after the lock ("frame steadied, then it is named"). Brackets arrive from 76 px outside (or >= 1000 px for the fly-in version), spring damping ~15 / stiffness ~210, one visible overshoot, arm length 40 to 26 px and no longer than 1/4 of the target's short side.
- Focus flash fill peak 7.5 % (above 12 % it reads as "selected"). Counter must be driven by what has fired, not hard-coded.
- Document version: pop 0.86 to 1 in 0.37 s, four brackets 34 px staggered 0.022, five passes with ease-in-out and a 12 % pause at each end; band 1.2 px core + 10 px glow + <= 82 px trail, clipped to the document; the document stays still, only the light moves.
- Max twice per film; the second lock must be on a different target.
- Light page: use deep saturated machine colour; pale glows vanish.

## Sound for it
`mouse_click` or `ui_tap` at each lock, mechanical not game-UI (-18 dB), a faint `whoosh_medium` under the scan.

## Common mistakes
- Annotating before the band passes: it becomes a pre-made animation.
- Brackets that become a full frame.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/effects/scanline-annotate-focus.md`, `shots/effects/scan-bracket-sweep.md` and `shots/effects/fui-hud-moves.md` (Apache-2.0; see ../NOTICE).
