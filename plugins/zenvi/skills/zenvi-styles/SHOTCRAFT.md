# video-shotcraft → Zenvi

The 124 shot recipe cards of video-shotcraft (Apache-2.0; see `NOTICE`) translated into Zenvi techniques: **93
`techniques/shot-*.md` files** (cards that are one move merged into one file) plus the cards that duplicate an existing
technique (`dup-of`: no new file; the numbers worth adding to that technique are in the note). Zenvi does not use
Remotion: each file builds the card's intent with Zenvi tools (motion blocks, 3D scenes, native keyframes, transitions,
FX, sound) and says `needs:` where a capability is missing. Index entries come from each file's front matter.

Verified (rendered through the CLI, contact sheet checked, watch judge once, absolute, isolated 3-6 s tests):
20 files — `shot-aurora-flip` 6.8, `shot-bento-light-up` 4.9, `shot-blur-slide` 5.45, `shot-card-stack-fan` 4.9, `shot-cloner-depth-echo` 5.6, `shot-crane-rise-reveal` 2.8, `shot-crash-zoom-punch` 5.3, `shot-cursor-flyover` 6.4, `shot-glitch-cycle` 7.73, `shot-glitch-tear-cut` 3.18, `shot-gradient-word-sweep` 3.0, `shot-lead-word-zoom-assemble` 3.82, `shot-light-sweep` 5.5, `shot-match-iris-window` 3.0, `shot-mosaic-reflow` 3.36, `shot-paparazzi-flash-crops` 5.55, `shot-stack-press-count` 6.1, `shot-theme-switch` 4.7, `shot-type-and-filter` 6.6, `shot-ui-to-brand-morph` 8.1. Every other file says "Not rendered yet".

## Card → technique

| card | → file (or dup-of id) | needs | note |
| --- | --- | --- | --- |
| camera/basic-3d-scene | shot-station-flythrough | perspective-plane-showcase | merged with terminal-3d; flat 2D camera = inverse pose (scale, rotation, location) on every card; Y/X tilt missing |
| camera/terminal-3d | shot-station-flythrough | perspective-plane-showcase | typing stations via `code_card` block, typing only after arrival |
| camera/cursor-flyover | shot-cursor-flyover | none | `cursor_path` block does it natively; verified |
| camera/crash-zoom-punch | shot-crash-zoom-punch | none | keyframes (scale, location) + baked `radial_blur` + shake keyframes; verified |
| camera/depth-layer-moves | shot-multiplane-slider | parallax-layer-camera-rig | 3 clip copies at 0.35x/0.7x/1.4x; hand-driven; near cousin of `cinematic-parallax` (UI/page version with a landing) |
| camera/graze-face-tour | shot-tilted-plane-glide | perspective-plane-showcase, planar-surface-track-overlay | merged with steep-tilt-glide; floating text landing approximated by scale + shadow keyframes |
| camera/steep-tilt-glide | shot-tilted-plane-glide | perspective-plane-showcase, planar-surface-track-overlay | camera constant, page moves (60 degrees is the identity) |
| camera/overhead-camera-moves | shot-overhead-tilt-drop | perspective-plane-showcase | tilt-reveal + tabletop drop; flat tabletop fallback |
| camera/space-camera-moves | shot-overhead-tilt-drop (drone dive) and shot-exploded-layers (exploded view) | perspective-plane-showcase; exploded-view-3d | one card, two moves, two files; `card_stack` 3D scene as the exploded stand-in |
| camera/tension-camera-moves | shot-pullback-isolation | perspective-plane-showcase (bullet-time orbit only) | pull-back is fully native; bullet-time via `speed_ramp_tool` freeze + camera layer |
| data/before-after-slider-scrub | shot-before-after-scrub | ab-compare-layout | no driven divider; wipe preset / mask grow fallbacks, honest |
| data/chart-live-moves | shot-live-chart | pictogram-chart-morph, live-chart-render | `chart_build` + `particle_burst` + `counter`; oscilloscope, dot swarm, axis rescale not native |
| data/gauge-readout-moves | shot-gauge-readout | gauge-dial-render | `counter` odometer for tape; still-image dial with rotation keyframes |
| data/scroll-brake-moves | shot-brake-scroll | none | `ease_out_expo` on `location_y` + baked `directional_blur` |
| data/timeline-travel | shot-brake-scroll | none | horizontal cousin in the same file |
| effects/assemble-then-type-flyin | shot-assemble-flyin | component-assemble-flyin | two-stage skeleton then letters; `kcut-assemble` is the particle-word variant |
| effects/scanline-assemble-flyin | shot-assemble-flyin | component-assemble-flyin | scan-line variant, constant speed |
| effects/aurora-bloom-bg-flip | shot-aurora-flip | none | `gradient_field` aurora + dark card with 0.36 s fade; verified |
| effects/brand-frame-snap | shot-brand-frame-snap | none | `Solid_Color` cards as frame + scaled capture, hard colour cut + flash |
| effects/fui-hud-moves | shot-scan-annotate | reticle-bracket-overlay | reticle lock-on merged into the scan-annotate file |
| effects/glow-flyline-moves | shot-glow-flyline | svg-path-write-on | `gradient_field` + `glass_cards` + `particle_burst` rings; arc is a moved bar with echo trail |
| effects/icon-performance-moves | shot-attention-bounce | none | gravity ease keyframes on `location_y` + squash on scale |
| effects/impact-feedback | dup-of kcut-hit-fx | none | add to kcut-hit-fx: invert/negative impact = 3 frames (4 reads as a trick) with radial speed lines (34 wedges + 22 needles changing each frame) and red/cyan copies at +-8 px, off on frame 4, then 6 px shake with tau 2.2 f quiet by ~12 f. Hit-counter variant: global 2-frame freeze per hit (background included), damage numbers 88/104/124 px rising 150 px, 12 f fade after 4 f, combo counter pulses 1.3/1.45/1.6 with rotation -2/-4/-6 degrees; hits every 28 f. Negative frames are loud in paper-and-ink films; one per film, same frame as the impact sound |
| effects/light-play-moves | shot-light-sweep | none | spotlight via scrim-with-hole + travelling clip; sheen via `set_clip_properties_tool` composite screen (not rendered) |
| effects/radial-ripple-phone-chips | shot-phone-ripple-chips | concentric-ripple-field | `device_mockup` scene or masked recording; chips = kinetic titles |
| effects/riso-print-hits | shot-riso-misregistration | none | two ink-colour titles with multiply composite, damped offset keyframes, hard snap |
| effects/scan-bracket-sweep | shot-scan-annotate | reticle-bracket-overlay, scan-band-overlay | document variant, five passes |
| effects/scanline-annotate-focus | shot-scan-annotate | reticle-bracket-overlay, scan-band-overlay | `hud_callouts` block as the label layer; trigger = scan passes bbox bottom edge |
| effects/slam-entrance-moves | shot-slam-entrance | none | transform keyframes + `particle_burst` + shake; perspective-snap variant only approximated; overlaps `kcut-slam-word` (word vs card) |
| effects/spotlight-sweep-moves | shot-light-sweep | none | merged with light-play-moves |
| interaction/autolayout-gap-dial | shot-parameter-dial | parameter-driven-layout | one source of truth sampled in a script; counter block as the readout (sync to nudge by hand) |
| interaction/canvas-materialize-moves | shot-canvas-materialize | diagram-tree-block | A via masonry_grid, B prompt_bar + hand-keyed tree stills |
| interaction/chip-grid-single-select-blackout | shot-control-state-change (merged with segmented-thumb-hero) | | 1-frame grey flash via add_title_tool; counter block for the price |
| interaction/collab-cursor-moves | shot-collab-cursors | multi-cursor-ensemble | cursor_path is one pointer on one screenshot; cast built from stills + sampled sines |
| interaction/glass-pill-dictation-typing | shot-voice-input-pill (merged with voice-waveform-live) | live-waveform-bars | liquid_glass block for the pill; warm light = gradient_field alpha fade |
| interaction/hashtag-to-pill-materialize | shot-type-to-pill | | two hard cuts around one eased glide; typewriter title + pill still |
| interaction/picker-carousel-feature-cycle | shot-picker-carousel | | word_rotator style=slot is the same mechanism |
| interaction/segmented-thumb-hero | shot-control-state-change | | thumb/pointer/icon as stills with 8-frame keyframes |
| interaction/theme-switch-moves | shot-theme-switch | keyframed-polygon-mask | ripple via ellipse shape mask with grow keyframes (verified); slanted sweep not possible |
| interaction/type-and-filter | shot-type-and-filter | grid-cell-reflow | prompt_bar + cursor_path (verified); filter is a cut |
| interaction/voice-waveform-live | shot-voice-input-pill | live-waveform-bars | no bar-equaliser; kcut-draw-on is the nearest |
| opening/brand-ink-open | shot-brand-ink-open | | hud_callouts crosshair + kinetic_headline blur + hold 1 s |
| opening/crane-rise-reveal | shot-crane-rise-reveal | screen-capture-smart-zoom | four-property keyframes on one ease (verified) |
| opening/dataviz-landscape-open | shot-dataviz-landscape-open | perspective-ground-flow | gradient_field + line_trails + hud_callouts as a stand-in |
| opening/fracture | shot-fracture | tile-3d-assemble | flat 4x4/5x5 masked tiles scripted; shards burst on the exit |
| opening/icon-field-colorize | shot-icon-field-colorize | keyframed-polygon-mask | grey/lit stills + slide-down transition; mask only grows from centre |
| opening/letterspace-materialize | dup-of kinetic-write-on | | add: all letters start and finish on the SAME frame (zero stagger), 50 frames (~1.7 s) draw ease-in-out, tracking ~0.6 em, glyph aspect ~1.07 wide, thin skeleton stroke, hold >= 1 s on the finished word |
| opening/magician-card-flourish | shot-magician-card-flourish | | particle_burst lines for the star (blue, no white ball), card keyframes with 13 whole turns; light brand-neutral |
| opening/orbit-ring-title-open | shot-orbit-ring-title-open | orbit-ring-carousel | scripted ellipse keyframes for 8 cards, or floating_cards 3D |
| opening/spotlight-hero-card | shot-spotlight-hero-card | moving-spotlight-mask | one dim clip + feathered outside-mask per station |
| opening/stroke-segment-build | shot-stroke-segment-build | segmented-stroke-reveal | text_scramble blocks fallback; neutral word (no film title) |
| opening/text-as-mask | dup-of kinetic-stencil-reveal | | add: heavy weight (900), type ~72 % of the frame width; content drifts 300 px over 78 frames inside the letters; 8-frame breath 1 -> 0.965; then a 24-frame blow-up to ~46x on a t^1.8 curve with the origin inside a solid stroke; the unmasked full-frame layer fades in only once a stroke covers the frame (~24x); hold >= 30 frames, content still moving |
| outro/grain-dissolve | shot-grain-dissolve | text-to-grain-dissolve | particle dots + scramble title; kcut-assemble is the better second half |
| outro/logo-shrink-wordmark-lockup | shot-ui-to-brand-morph (merged with ui-to-brand-morph) | | lockup tail: ring scale 5.4 -> 1 with +6 % overshoot, mark left, letters stagger, tagline fades whole; the generated logo_build is its stand-in |
| outro/neon-triple-marquee | dup-of kcut-marquee-bands | | add: 3 rows counter-scrolling (rows 1 and 3 right, 2 left, 9/11/9 px per frame at 1080p), ONE row lit at a time (42-frame cycle, 14-frame slots with 2-frame overlap, dark state kept at 0.3 so all three rows stay visible), tube = stroke only + 3-layer glow (9/36/90 px) and wall spill, wall tilted rotateY -17 -> -9 degrees, power on 5 frames per row, power off 6 frames per row to a dark-tube poster, no full-bright |
| outro/outro-group-photo-launch | shot-outro-group-photo-launch | | native keyframes with an overshooting ease; logo_reveal_end for the wordmark; riser / boom / sparkle three-beat |
| outro/ui-strip-away-outro | shot-ui-strip-away-outro | | needs the UI as separate layer stills; button migrates to centre then logo_reveal_end |
| outro/ui-to-brand-morph | shot-ui-to-brand-morph | | logo_build after a UI collapse (verified); A flip and B piece-assembly described |
| rhythm/beat-cut-moves | shot-paparazzi-flash-crops | - | verified; flash_white x3 + scale crops + camera_shutter |
| rhythm/beat-step-list-theme-cycle | shot-theme-cycle-beat-list | motion-block-word-cues | word_rotator + per-beat colour cards; no per-word beat input, no pill lens |
| rhythm/panel-grid-moves | shot-panel-grid-beats | skewed-mask-cascade | merged with quad-split; overlaps `multi-panel-and-card-video-layout` (this one adds the comic slash / parallel stagger rules) |
| rhythm/quad-split-parallel-scenes | shot-panel-grid-beats | multi-clip-grid-layout, tile-event-stagger | grid template, tiles cannot be offset by 3-6 frames |
| rhythm/rhythm-interrupt-moves | shot-jump-cut-punch-in | - | three scale steps, one origin; t041 is the single-punch cousin |
| rhythm/sakuga-timing-shift | shot-on-threes-to-ones | - | set_keyframes_tool interpolation=constant every 0.1 s, then bezier sprint |
| rhythm/speed-ramp-freeze | shot-freeze-annotate | path-write-on | speed_ramp_tool custom + hud_callouts; cinematic-speed-ramp is the ramp-only cousin |
| rhythm/trailer-grammar-moves | shot-trailer-bumper-hook | - | 3 x 9 f shots, 0.2 s pure black, title; pairs with cinematic-silence-before-hit |
| transition/bottom-push-stack-wipe | shot-bottom-push-chapters | - | slide up on every join + saturated chapter cards; no seam-shadow layer |
| transition/card-flip-reveal | shot-card-flip-reveal | card-flip-3d | scale_x fake flip about the card centre |
| transition/card-flock-tumble | shot-card-flock-tumble | turbulent-smoke-ring | card_stack 3D scene + rings burst + slam word |
| transition/circle-match-iris | shot-match-iris-window | - | verified; ellipse mask grow keyframes on the anchor centre |
| transition/gradient-transition | shot-gradient-type-shift | gradient-param-field | three gradient_field layers cross-faded; no angle/centre/conic params |
| transition/line-carry-transition | shot-line-carry-transition | path-write-on | slide transition + lower_third rule as the weak stand-in |
| transition/mosaic-reframe | shot-mosaic-reflow | grid-cell-reflow | verified; grid steps [4,6,9], hard re-cuts, not a morph |
| transition/page-turn-transitions | shot-solid-page-wipes | lit-edge-wipe | barn door by two half-masked copies + location_x |
| transition/print-texture-transitions | shot-ink-bleed-reveal | ink-edge-shader | feathered ellipse mask, uneven keyframes |
| transition/shot-transitions | shot-hidden-cut-masks (A flash-cut), shot-match-iris-window (C portal); B = dup-of whip-transition-motion-blur-smear | - | B numbers to add to whip-transition-motion-blur-smear / cinematic-whip-cut: hold >= 20 f before, peak speed ~300 px/f (smear must be unreadable or the swap shows), long tail <= 60 f (48 f typical), one continuous velocity curve not two eases, same horizontal line for both scenes; flash/whip/portal never stacked on one seam |
| transition/tear-streak-transitions | shot-glitch-tear-cut | glitch-strip-displace | verified; glitch fx + chromatic_aberration windows + glitch preset |
| transition/transition-hidden-cut | shot-hidden-cut-masks (A blocker, B versus); C = dup-of cinematic-light-leak | occluder-plate-wipe, polygon-matte-transition | C numbers for cinematic-light-leak: leak ramps t^2 over 28 f (slow build), cut on the peak frame, 43 f ease-out cooldown, at the peak page brightness +85 %, contrast -50 %, saturation -25 % and old title fades to ~25 % (the burn-through), light blobs offset along the sweep (not concentric), once per film, counts with flash-cut as two light covers |
| transition/transition-travel | dup-of kinetic-stencil-reveal | - | numbers to add: zoom = 30^u over 52 f with bezier (0.6, 0, 0.85, 0.5), 2 % pull-back anticipation 26-34 f before; origin on the middle of a stroke that is wider than the frame; the hole must hold light only (no readable text inside); cover fades at scale 14-26; blur divided by scale, four ghost layers 0.8-3.2 f back; page ends at 1.08x, keep a 4 % safe margin; one seam one move |
| transition/white-flash-logo-simplify-cut | shot-flash-simplify-wordmark | liquid-metal-text | ported as a generic wordmark sting (chrome 3D title -> flash_white -> flat title); no brand logo imitated |
| transition/wipe-transitions | shot-solid-page-wipes | blinds-3d-wipe | merged with page-turn; blinds only as a needs: |
| blur-slide | shot-blur-slide | | Calm default reveal: kinetic_headline style=blur + documentary subtitle started ~0.9 s early. Verified. |
| paper-title-card | shot-blur-slide (merged) | | Letterpress press-in (scale 1.28 to 1, blur 7 px, 4-frame stagger, one accent italic word, closing rule) folded in as the paper-card variant. |
| brace-expand | shot-brace-expand | bracket-curtain-reveal | Two brace titles + Crop on the text tied to the same ease_out_back window. Not rendered. |
| countdown-arc-scatter | shot-countdown-arc-scatter | arc-dial-numbers | Fallback = counter block 45..5 then kinetic_headline with the number as accent. Not rendered. |
| document-typewriter-reveal | shot-document-typewriter-reveal | document-window-typewriter | Fallback code_card + notification_stack rail, or a real screen capture revealed with Crop. Not rendered. |
| flying-words | shot-flying-words | word-tunnel-3d | Fallback = 10-14 title clips with scale/location/alpha keyframes (fake depth). Not rendered. |
| glitch-cycle | shot-glitch-cycle | | text_scramble x4 + glitch transition per cut + glitch_burst. Verified, best score. |
| gradient-word-sweep | shot-gradient-word-sweep | type-gradient-sheen | Three copies of the keyword + keyframed Crop (left/right) for the sweep and front band; no glow or sparks. Verified (weak). |
| lead-word-zoom-assemble | shot-lead-word-zoom-assemble | pivot-scale-keyframes | Two titles; scale from top-left needs position compensation (formula in the file). Verified. |
| marker-underline-title | shot-marker-underline-title | marker-stroke-shape | Colour-card title + shape mask + Crop draw-on + rotation; the bar build was probed (applies), not rendered with the sheet. |
| outline-word-fill | shot-outline-word-fill | outline-text-style | Dim copy + lit copy switched by a constant keyframe; hud_callouts rules, particle_burst ring. |
| word-relay-geometry | shot-outline-word-fill (merged) | outline-text-style | Three-word geometry relay folded in as a variant (entrance 14 f, exit 10 f, only word 3 gets the chrome upgrade). |
| pill-chip-slot-cycle-handled | dup-of kinetic-word-rotator | | Add: width-adaptive dark chip (height 48, width = text + 74 px), neighbours pushed apart not squashed; switches at 0.25/0.47/0.69 of 150 f, each 18 f in-out cubic; ghost rows above/below at 13 % opacity moving at half speed; keep word-length ratio under 2x. Block has no width-adaptive chip: slot style only. |
| pill-slot-cycle | dup-of kinetic-word-rotator | | Add: 21 f per word (8 f swap, 13 f rest), 5-7 words; in +120 px / out -130 px with vertical blur 14/12 px; sentence stem anchored left, never centred until the finished sentence; closing phrase lands with one back(1.4) overshoot and holds at least 45 f at the same size/weight as the stem. |
| vertical-word-roll-blur-cycle | dup-of kinetic-word-rotator | | Add: three-row window (centre row sharp), neighbours blurred 3-5 px vertical only and faded 0.35/0.1; swaps of 16 f (0.55 s) on 0.7 outQuint + 0.3 outBack, 13 f rest between; the centre word turns grey to accent only when settled; stem and roll the same size/weight; hold ~40 f then fade the whole group. |
| text-column-converge | shot-text-column-converge | | Native titles, one slide of 36 f after pinned edge-to-edge terms with uneven 7-16 f holds. Not rendered. |
| title-demote-to-label | shot-title-demote-to-label | | Native title scale to 0.22 + travel to the corner on one 26 f ease; content starts 12 f into the flight. Not rendered. |
| type-assembly-moves | shot-type-assembly | | Primary: drift-assembly (letters clips + per-letter keyframes + Blur). Its split-text-stagger variant is kinetic-mask-reveal and its text-on-path variant is kinetic-text-on-path (noted in the file). Not rendered. |
| type-entrance-moves | dup-of kinetic-letter-cascade | | Add the physics-drop variant: start frame of letter i = 4 + 36(1-(1-i/(n-1))^1.5); gravity fall, bounces 30 % then 9 % of the drop (never three), rest tilt random within +-6 degrees, then one collective straighten in 6 f (rotate to 0, scale 1.06 to 1); hold at least 20 f; avoid g/j/p/q/y baselines. |
| type-rhythm-sync | shot-type-rhythm-sync | variable-weight-text | Weight pump (A) is the new file; the karaoke-fill half (B) is dup-of kinetic-karaoke (per-word windows 18-33 f with 4-10 f breaths, current word in accent, finished words fall back to ink, at most 6 words per screen). Not rendered. |
| typewriter-moves | dup-of kinetic-typewriter | | Add the error-retype variant: type 2 f/char, pause 16 f with two cursor blinks (4 f half period), delete 1.5 f/char, retype 1.5 f/char without hesitation; cursor solid while typing/deleting, blinking only on the pause; fixed-width slots; hold at least 50 f; once per film; backspace sound lower in pitch. |
| word-relay-filmstrip | shot-word-relay-filmstrip | | Cards as clips stepped by location_y keyframes, verb as titles; centre of verb block on the active card. Not rendered. |
| avatar-bracket-carousel | shot-bracket-slot-carousel | svg-icon-morph-scene | word_rotator slot for text; picture slot by keyframed stills; frame ticks from hud_callouts |
| bezier-source-converge-merge | shot-source-hub-connect | svg-path-write-on | merged with integration-hub-map; nodes keyframed along the curve, lines not drawable |
| integration-hub-map | shot-source-hub-connect | svg-path-write-on | variant B (page flip + simultaneous connect); flip approximated by spin transition |
| deck-deal-flyin | shot-card-stack-fan | video-card-cascade-layout | the long accelerating deal; grid deal with chase camera not available |
| list-stack-press | shot-stack-press-count | none | notification_stack + counter blocks |
| research-card-stack-scroll | shot-stack-press-count | none | same move with a fast 12 f beat; blur/dim by depth is inside notification_stack |
| carousel-3d | shot-carousel-ring | ring-carousel-3d | no ring scene; flat keyframed approximation only |
| cloner-depth-echo | shot-cloner-depth-echo | parallax-camera-rig | native clones on stacked tracks + keyframes; close to T002 (3D product) but UI card, scale meaning |
| doc-park-left-pill-deal | shot-doc-park-pill-deal | auto-sized-pill-title, word-highlight-box | park via keyframes, pills as titles, captions as cues |
| draw-svg-trace | shot-outline-trace-reveal | svg-path-write-on | merged with wall-reveal-moves B; mask-wipe fallback only |
| wall-reveal-moves | shot-bento-light-up (A) + shot-outline-trace-reveal (B) | grid-cell-reflow (A) | split: A bento light-up is its own file, B wireframe draw-on merged with draw-svg-trace |
| element-body-moves | shot-contact-shadow-lift | contact-shadow | shadow as a separate blurred clip, keyframed apart from the card |
| list-reveal | shot-list-item-entrance | video-card-cascade-layout | rows as titles + keyframes, or toggle_panel block |
| row-embed | shot-list-item-entrance | video-card-cascade-layout | merged with list-reveal; rotateX flatten not available |
| neon-frame-forerun | shot-neon-frame-landing | neon-tube-frame, perspective-plane-camera | variant A (fixed camera, staggered landing) |
| neon-frame-orbit-drop | shot-neon-frame-landing | neon-tube-frame, perspective-plane-camera | variant B (orbit, simultaneous landing); opposite stagger rule |
| page-waterfall-wall | shot-page-waterfall-wall | perspective-plane-camera, grid-cell-reflow | flat columns with per-column keyframed speeds, no 3D tilt |
| product-card-progressive-assemble | shot-product-card-assemble | word-highlight-box, auto-sized-pill-title | field-by-field titles; cursor_path block as the closest fill cursor |
| radial-wave | shot-stagger-wave-grid | grid-cell-reflow | dot_grid_reveal block (no return pulse, no custom origin) |
| value-stagger-gradient | shot-stagger-wave-grid | grid-cell-reflow | chart_build bars give the height gradient; hue/blur gradient and centre-origin beat missing |


## Capabilities the cards need that Zenvi lacks

New gap ids (not in refs2/GAPS.md yet), from the `needs:` of these files: `blinds-3d-wipe`, `card-flip-3d`, `component-assemble-flyin`, `concentric-ripple-field`, `contact-shadow`, `diagram-tree-block`, `gauge-dial-render`, `glitch-strip-displace`, `gradient-param-field`, `grid-cell-reflow`, `ink-edge-shader`, `keyframed-polygon-mask`, `liquid-metal-text`, `lit-edge-wipe`, `live-chart-render`, `live-waveform-bars`, `motion-block-word-cues`, `moving-spotlight-mask`, `multi-cursor-ensemble`, `neon-tube-frame`, `occluder-plate-wipe`, `orbit-ring-carousel`, `parameter-driven-layout`, `path-write-on`, `perspective-ground-flow`, `polygon-matte-transition`, `reticle-bracket-overlay`, `ring-carousel-3d`, `scan-band-overlay`, `screen-capture-smart-zoom`, `segmented-stroke-reveal`, `skewed-mask-cascade`, `text`, `text-to-grain-dissolve`, `tile-3d-assemble`, `tile-event-stagger`, `turbulent-smoke-ring`.
