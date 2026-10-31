# cinetic → Zenvi

cinetic's technique library (273 entries in 14 categories, MIT, (c) 2026 Leonxlnx; see `NOTICE`) translated into
Zenvi: **247 `techniques/cin-*.md` files** plus 26 entries that are the same move as an existing Zenvi technique
(`dup of`: no new file; the draw hands out the existing file, and the cinetic numbers worth adding are in the note).
Zenvi uses neither Remotion nor HyperFrames: each file rebuilds the entry's intent with Zenvi tools and keeps its
60 fps timings as frames and seconds; `needs:` names what Zenvi lacks for the full look, with a fallback.

These files are not in the index table: a `cinetic-*` style's brief draws them (packages/engine/src/brief/draw.ts,
after cinetic's pick.py: about one per 3.5 s calm or 2.5 s crisp, in the format's order of need, weighted by role,
proof and energy, never the last three films' picks). The method is `METHOD-cinetic.md`; the formats are
`styles/cinetic-launch-film.md`, `cinetic-teaser.md`, `cinetic-feature-loop.md`, `cinetic-logo-sting.md` and
`cinetic-ui-walkthrough.md`.

Regenerate the files from the translations with the porting script kept outside the repo (fleet worker x2-cinetic);
edit a technique file directly once it is in the repo.

## Entry → technique

| cinetic id | → file (or dup of) | category | needs / note |
| --- | --- | --- | --- |
| `oh-live-grid-cold-open` | [cin-oh-live-grid-cold-open](techniques/cin-oh-live-grid-cold-open.md) | opening_hook | grid-cell-reflow |
| `oh-macro-scramble-snap-out` | [cin-oh-macro-scramble-snap-out](techniques/cin-oh-macro-scramble-snap-out.md) | opening_hook | digit-column-reroll-control |
| `oh-mark-build-and-throw` | [cin-oh-mark-build-and-throw](techniques/cin-oh-mark-build-and-throw.md) | opening_hook | - |
| `oh-quiet-intro-drop` | [cin-oh-quiet-intro-drop](techniques/cin-oh-quiet-intro-drop.md) | opening_hook | - |
| `oh-cursor-search-push` | [cin-oh-cursor-search-push](techniques/cin-oh-cursor-search-push.md) | opening_hook | - |
| `oh-oversize-fly-then-small` | [cin-oh-oversize-fly-then-small](techniques/cin-oh-oversize-fly-then-small.md) | opening_hook | - |
| `oh-pile-up-freeze-turn` | [cin-oh-pile-up-freeze-turn](techniques/cin-oh-pile-up-freeze-turn.md) | opening_hook | accelerating-stagger-control |
| `oh-result-first-rewind` | [cin-oh-result-first-rewind](techniques/cin-oh-result-first-rewind.md) | opening_hook | - |
| `oh-click-starts-film` | [cin-oh-click-starts-film](techniques/cin-oh-click-starts-film.md) | opening_hook | - |
| `oh-cropped-word-pull-back` | [cin-oh-cropped-word-pull-back](techniques/cin-oh-cropped-word-pull-back.md) | opening_hook | - |
| `tr-velocity-handoff-cut` | [cin-tr-velocity-handoff-cut](techniques/cin-tr-velocity-handoff-cut.md) | transition | - |
| `tr-scale-through-cut` | [cin-tr-scale-through-cut](techniques/cin-tr-scale-through-cut.md) | transition | - |
| `tr-anchor-overlay-cut` | [cin-tr-anchor-overlay-cut](techniques/cin-tr-anchor-overlay-cut.md) | transition | - |
| `tr-polarity-flip-cut` | dup of `t105` | transition | Add cinetic's rules: the two sides differ by 150+ of 255 in mean luma; carry the flip by ending on a shape at P and opening on the same shape within 20 px at 1-2.5x with fill and ground swapped (ink icon on paper becomes paper icon on ink); the incoming shape is already drifting (-36 px over 30 f); optional 2 ghost frames at 0.12 then 0.94 opacity; no flash or dip to black; wait 12-20 f before small type; at most one flip per bar and two per film. |
| `tr-shape-match-cut` | [cin-tr-shape-match-cut](techniques/cin-tr-shape-match-cut.md) | transition | - |
| `tr-giant-word-punch-out` | [cin-tr-giant-word-punch-out](techniques/cin-tr-giant-word-punch-out.md) | transition | tracking-animation |
| `tr-dot-relay` | [cin-tr-dot-relay](techniques/cin-tr-dot-relay.md) | transition | - |
| `tr-defocus-cut` | [cin-tr-defocus-cut](techniques/cin-tr-defocus-cut.md) | transition | - |
| `tr-path-relay` | [cin-tr-path-relay](techniques/cin-tr-path-relay.md) | transition | path-write-on |
| `tr-iris-from-glyph` | dup of `shot-match-iris-window` | transition | Add cinetic's numbers: seed dot of 14 px in the next scene's colour appears on the glyph (scale 0 to 1 over 6 f, hold 6-10 f), then the radius grows at a constant ratio of x1.25-1.29 per frame (exponential, never linear: linear crawls then snaps) over 20 f while the centre drifts to the frame centre on a smooth ease; optional 90 px ring left as set dressing; funnel variant x1.18 per frame over 24 f for an app icon; same iris at most twice per film. |
| `tr-portal-aspect-zoom` | [cin-tr-portal-aspect-zoom](techniques/cin-tr-portal-aspect-zoom.md) | transition | - |
| `tr-band-wipe` | [cin-tr-band-wipe](techniques/cin-tr-band-wipe.md) | transition | keyframed-polygon-mask |
| `tr-horizon-rise` | [cin-tr-horizon-rise](techniques/cin-tr-horizon-rise.md) | transition | - |
| `tr-cover-wipe` | [cin-tr-cover-wipe](techniques/cin-tr-cover-wipe.md) | transition | - |
| `tr-subtract-reveal` | [cin-tr-subtract-reveal](techniques/cin-tr-subtract-reveal.md) | transition | - |
| `tr-conveyor-line-swap` | [cin-tr-conveyor-line-swap](techniques/cin-tr-conveyor-line-swap.md) | transition | - |
| `tr-motion-masked-swap` | [cin-tr-motion-masked-swap](techniques/cin-tr-motion-masked-swap.md) | transition | - |
| `tr-tip-back-exit` | [cin-tr-tip-back-exit](techniques/cin-tr-tip-back-exit.md) | transition | perspective-plane-showcase |
| `tr-envelope-match-type-cut` | [cin-tr-envelope-match-type-cut](techniques/cin-tr-envelope-match-type-cut.md) | transition | - |
| `tr-drift-matched-angle-cut` | [cin-tr-drift-matched-angle-cut](techniques/cin-tr-drift-matched-angle-cut.md) | transition | - |
| `tr-select-retype-swap` | [cin-tr-select-retype-swap](techniques/cin-tr-select-retype-swap.md) | transition | text-selection-highlight |
| `tr-stepped-column-fill` | [cin-tr-stepped-column-fill](techniques/cin-tr-stepped-column-fill.md) | transition | grid-cell-reflow |
| `cam-living-hold` | dup of `cinematic-push-in` | camera | Add cinetic's numbers for the hold itself: creep 0.04-0.07 % per frame (+2.4 to +4.2 % a second, 0.1 % per frame at most in a 40-60 f tail after a big push), pulls about -0.08 % per frame on busy boards, 0.0125 % per frame on the end card, lateral drift 0.3-0.5 px/f for UI and 1.5-3 px/f for big type; the creep is released over the next move's own ease and never stacked on a punch-in drift on the same axis; any hold over about 30 f gets one, except a designed freeze of 15 f or less. |
| `cam-breathing-zoom` | [cin-cam-breathing-zoom](techniques/cin-cam-breathing-zoom.md) | camera | - |
| `cam-punch-in-insert` | dup of `shot-jump-cut-punch-in` | camera | Add cinetic's numbers: on-axis punch 2.0-2.5x, macro of the exact control 3-4.5x, wide holds 20-64 f (90-220 f when it establishes the scene), close-up about 60 f, macro 46-74 f (76-154 f when it carries an action); cut on the click, keystroke or beat with no transition frames; animations keep running across the cut; never hold the insert still (1-2 px/f drift, or open with a +8 % offset decaying over 96 f); build UI live at final size so text stays sharp at 4.5x; cut back out on the next action; 2-3 punches on consecutive beats for a staccato build. |
| `cam-detail-first-pullback` | dup of `shot-crane-rise-reveal` | camera | Add cinetic's numbers: tight hold at k 1.6-1.7 for 24-52 f while the value animates (keep under 52 f), pull to 1.0 over 52 f on a smooth ease (peak about 4 % per frame) or a settle over 56-80 f; partly cropped edge tiles fade out over the 16 f before the pull; window chrome and neighbours fade in over 30 f from 20 % of the move, optionally from a 10 px blur; the hero tips pitch 0 to 6 to 0 degrees as it docks; for an end-of-film re-establish open soft (6 px blur) at k 2.2 and resolve over 60 f. |
| `cam-hero-push-yaw` | [cin-cam-hero-push-yaw](techniques/cin-cam-hero-push-yaw.md) | camera | perspective-plane-showcase |
| `cam-dolly-surge-foreground` | [cin-cam-dolly-surge-foreground](techniques/cin-cam-dolly-surge-foreground.md) | camera | - |
| `cam-push-dutch-roll` | [cin-cam-push-dutch-roll](techniques/cin-cam-push-dutch-roll.md) | camera | - |
| `cam-isolating-push` | [cin-cam-isolating-push](techniques/cin-cam-isolating-push.md) | camera | - |
| `cam-reframe-to-subject` | [cin-cam-reframe-to-subject](techniques/cin-cam-reframe-to-subject.md) | camera | - |
| `cam-pull-lands-event` | [cin-cam-pull-lands-event](techniques/cin-cam-pull-lands-event.md) | camera | - |
| `cam-cursor-whip-orbit` | [cin-cam-cursor-whip-orbit](techniques/cin-cam-cursor-whip-orbit.md) | camera | perspective-plane-showcase |
| `cam-offframe-whip-relay` | [cin-cam-offframe-whip-relay](techniques/cin-cam-offframe-whip-relay.md) | camera | - |
| `cam-lead-follow` | [cin-cam-lead-follow](techniques/cin-cam-lead-follow.md) | camera | - |
| `cam-crane-push` | [cin-cam-crane-push](techniques/cin-cam-crane-push.md) | camera | - |
| `cam-crash-zoom-through` | [cin-cam-crash-zoom-through](techniques/cin-cam-crash-zoom-through.md) | camera | - |
| `cam-impact-kick` | dup of `kcut-hit-fx` | camera | Add cinetic's numbers for the camera part: jolt of 6-10 px in the direction of the incoming object's travel (attack 1 f, decay about 4 f, gone in ~25 f) plus a +1.5 % push (attack 2 f, decay 5 f), on the contact frame so sound and picture peak together, paired with a squash on the landing object, never any roll; use at most 2-3 times per film and only where something truly lands; never on every beat, soft UI arrivals or mid camera move. |
| `cam-parallax-truck` | dup of `cinematic-parallax` | camera | Add cinetic's numbers: at most three planes; one camera truck of 200-400 px over 90-120 f (1.5-2 s) on a smooth ease, or a constant 1-3 px/f drift for a hold; plane factors 0.3 (background) / 1.0 (subject) / 1.6 (foreground); scale the background 1.05-1.08 so its slower travel never shows an edge; subject text stays under 20 px/f and the fast foreground is text-free and motion-blurred; avoid on dense UI walkthroughs where the eye tracks one control. |
| `cam-seamless-loop-orbit` | [cin-cam-seamless-loop-orbit](techniques/cin-cam-seamless-loop-orbit.md) | camera | - |
| `cam-inside-object-pullout` | [cin-cam-inside-object-pullout](techniques/cin-cam-inside-object-pullout.md) | camera | - |
| `cam-z-field-flythrough` | [cin-cam-z-field-flythrough](techniques/cin-cam-z-field-flythrough.md) | camera | exploded-view-3d |
| `cam-fit-bounds-follow` | [cin-cam-fit-bounds-follow](techniques/cin-cam-fit-bounds-follow.md) | camera | - |
| `cam-zoom-out-hop` | [cin-cam-zoom-out-hop](techniques/cin-cam-zoom-out-hop.md) | camera | - |
| `ty-phrase-clamp-junction` | [cin-ty-phrase-clamp-junction](techniques/cin-ty-phrase-clamp-junction.md) | typography_motion | junction-anchored-text-halves |
| `ty-slot-roller-fixed-phrase` | dup of `kinetic-word-rotator` | typography_motion | Add cinetic numbers: step roll 20 f (0.33 s) every 29-34 f; accelerating run of 7 items at intervals 26/14/12/8/8/4/4 f (0.43/0.23/0.2/0.13/0.13/0.07/0.07 s) where steps under 12 f are hard swaps, last item settles with a small detent and a tick per step; pitch 1.5x font size; neighbours at most 1.3:1 contrast so they read as slivers; cap at about 7 items. |
| `ty-masked-baseline-rise` | dup of `kinetic-mask-reveal` | typography_motion | Add cinetic numbers: word rise 12 f (0.2 s, range 10-14) ease_out_expo over 110 % of the line box, opacity 0->1 over the first 3 f, stagger 6 f (0.1 s, range 4-10), per letter 3 f only for one short hero word, mask exit 10 f ease_in_cubic; pad the mask 0.15 em below for descenders. |
| `ty-blur-focus-word-rise` | dup of `shot-blur-slide` | typography_motion | Add cinetic numbers for the slower voice-paced variant: 28 f (0.47 s) per word, stagger 20-22 f (0.33-0.37 s), rise 0.11 em, blur 8 px gone by f4 while the word is still half transparent, colour resolving pale to full ink, 0.5 px/f line drift, URL path starts 8-12 f after the domain. |
| `ty-inplace-light-up-beats` | [cin-ty-inplace-light-up-beats](techniques/cin-ty-inplace-light-up-beats.md) | typography_motion | per-word-cue-times |
| `ty-typeon-timeboxed` | dup of `kinetic-typewriter` | typography_motion | Add cinetic numbers: every line finishes in a fixed 68 f (1.13 s) box whatever its length, on an out curve so 45 % of the string shows by f6 (0.1 s); mono UI labels instead run linear at 22-45 characters per second; pre-fill the first word; caret blinks 30 f on / 30 f off only after completion; replacing a line: accent 6 f, swap, retype in 26 f; hold at least 36 f + 6 f per word. |
| `ty-recentre-line-build` | [cin-ty-recentre-line-build](techniques/cin-ty-recentre-line-build.md) | typography_motion | live-recentring-text-line |
| `ty-staggered-word-roll` | [cin-ty-staggered-word-roll](techniques/cin-ty-staggered-word-roll.md) | typography_motion | - |
| `ty-reading-order-exit` | [cin-ty-reading-order-exit](techniques/cin-ty-reading-order-exit.md) | typography_motion | - |
| `ty-kinetic-word-slams` | [cin-ty-kinetic-word-slams](techniques/cin-ty-kinetic-word-slams.md) | typography_motion | - |
| `ty-multi-direction-assemble` | [cin-ty-multi-direction-assemble](techniques/cin-ty-multi-direction-assemble.md) | typography_motion | - |
| `ty-oversize-blur-slide-in` | [cin-ty-oversize-blur-slide-in](techniques/cin-ty-oversize-blur-slide-in.md) | typography_motion | - |
| `ty-blur-swap-rescale` | [cin-ty-blur-swap-rescale](techniques/cin-ty-blur-swap-rescale.md) | typography_motion | - |
| `ty-step-edit-performs-copy` | [cin-ty-step-edit-performs-copy](techniques/cin-ty-step-edit-performs-copy.md) | typography_motion | - |
| `ty-shared-letter-morph` | [cin-ty-shared-letter-morph](techniques/cin-ty-shared-letter-morph.md) | typography_motion | shared-letter-glyph-mapping |
| `ty-scramble-decode` | dup of `kinetic-scramble-decode` | typography_motion | Add cinetic numbers: one letter locks every 5 f (0.083 s, about 48 f for 10 characters), unlocked glyphs change every 2 f at 50 % opacity, pin slots to the target glyph advance so width never jitters, optional 12 f accent decay on lock; a code-roll variant steps each letter one character per frame for 4-8 steps. Keep it to keys, codes, short technical names, never prose or the end-card name. |
| `ty-front-restyle-sweep` | [cin-ty-front-restyle-sweep](techniques/cin-ty-front-restyle-sweep.md) | typography_motion | per-glyph-weight-morph |
| `ty-occlusion-spill-from-mark` | [cin-ty-occlusion-spill-from-mark](techniques/cin-ty-occlusion-spill-from-mark.md) | typography_motion | edge-following-reveal-mask |
| `ty-vertical-word-stack` | [cin-ty-vertical-word-stack](techniques/cin-ty-vertical-word-stack.md) | typography_motion | - |
| `ty-slice-band-assembly` | [cin-ty-slice-band-assembly](techniques/cin-ty-slice-band-assembly.md) | typography_motion | per-letter-band-offsets |
| `ty-slice-glitch-streak` | [cin-ty-slice-glitch-streak](techniques/cin-ty-slice-glitch-streak.md) | typography_motion | per-band-slice-displace |
| `ty-scaled-echo-extrusion` | [cin-ty-scaled-echo-extrusion](techniques/cin-ty-scaled-echo-extrusion.md) | typography_motion | - |
| `ty-swell-on-drop` | [cin-ty-swell-on-drop](techniques/cin-ty-swell-on-drop.md) | typography_motion | - |
| `ty-centre-out-unmask` | [cin-ty-centre-out-unmask](techniques/cin-ty-centre-out-unmask.md) | typography_motion | - |
| `ty-line-rebreak-glide` | [cin-ty-line-rebreak-glide](techniques/cin-ty-line-rebreak-glide.md) | typography_motion | - |
| `ui-orbit-gather-merge` | [cin-ui-orbit-gather-merge](techniques/cin-ui-orbit-gather-merge.md) | ui_choreography | closed-form-orbit-motion |
| `ui-path-fracture-fan` | [cin-ui-path-fracture-fan](techniques/cin-ui-path-fracture-fan.md) | ui_choreography | dashed-stroke-degrade |
| `ui-stalled-state` | [cin-ui-stalled-state](techniques/cin-ui-stalled-state.md) | ui_choreography | dashed-stroke-degrade |
| `ui-clutter-pileup-strip` | [cin-ui-clutter-pileup-strip](techniques/cin-ui-clutter-pileup-strip.md) | ui_choreography | - |
| `ui-card-grid-arrival` | [cin-ui-card-grid-arrival](techniques/cin-ui-card-grid-arrival.md) | ui_choreography | - |
| `ui-live-reflow` | [cin-ui-live-reflow](techniques/cin-ui-live-reflow.md) | ui_choreography | live-layout-reflow |
| `ui-row-cascade` | [cin-ui-row-cascade](techniques/cin-ui-row-cascade.md) | ui_choreography | - |
| `ui-fan-resolve-to-slots` | [cin-ui-fan-resolve-to-slots](techniques/cin-ui-fan-resolve-to-slots.md) | ui_choreography | card-flip-3d |
| `ui-lens-list-scroll` | dup of `shot-picker-carousel` | ui_choreography | Add its numbers: a flicked picker coasts 120 f (2.0 s) on a quartic ease, about 900 px at 30 px/f at the start, under 20 px/f after 15 f; focus scale 1.2 to 0.85 across 375 px with the text greying with distance. The cylinder (R = 1.4x height, perspective 1600 px, 480 px in 90 f) and smile-arc (R 1750 px) variants are not in the existing file. |
| `ui-discard-into-bin` | [cin-ui-discard-into-bin](techniques/cin-ui-discard-into-bin.md) | ui_choreography | - |
| `ui-push-aside-reflow` | [cin-ui-push-aside-reflow](techniques/cin-ui-push-aside-reflow.md) | ui_choreography | - |
| `ui-outline-led-reveal` | [cin-ui-outline-led-reveal](techniques/cin-ui-outline-led-reveal.md) | ui_choreography | - |
| `ui-anchor-point-spawn` | [cin-ui-anchor-point-spawn](techniques/cin-ui-anchor-point-spawn.md) | ui_choreography | - |
| `ui-shell-first-build` | [cin-ui-shell-first-build](techniques/cin-ui-shell-first-build.md) | ui_choreography | keyframed-polygon-mask |
| `ui-top-insert-push` | [cin-ui-top-insert-push](techniques/cin-ui-top-insert-push.md) | ui_choreography | - |
| `ui-container-morph` | [cin-ui-container-morph](techniques/cin-ui-container-morph.md) | ui_choreography | - |
| `ui-drag-reorder-makeway` | [cin-ui-drag-reorder-makeway](techniques/cin-ui-drag-reorder-makeway.md) | ui_choreography | - |
| `ui-progress-spine-steps` | [cin-ui-progress-spine-steps](techniques/cin-ui-progress-spine-steps.md) | ui_choreography | path-follow-head-with-holds |
| `ui-genie-launch-from-icon` | [cin-ui-genie-launch-from-icon](techniques/cin-ui-genie-launch-from-icon.md) | ui_choreography | keyframed-polygon-mask |
| `dn-ease-out-count-up` | dup of `kinetic-counter` | data_and_numbers | Add cinetic numbers: count from a credible 85-90 % of the target (173 to 195, 734 to 799) in 28 f (0.47 s) on a quad-out so early frames jump 2-3 units and the last unit lands in the final ~6 f; long ranges over ~500 units use a softer out; prices and recounts 36-46 f, ambient UI KPIs 36-104 f. Fixed digit count with separators and tabular figures so the box never changes width, digits replace in place with no crossfade, ticks thinned to one per 2 f, start on the frame its cause lands, hold at least 36 f + 6 f per label word under a 2-3 % push. |
| `dn-count-glyph-swap` | [cin-dn-count-glyph-swap](techniques/cin-dn-count-glyph-swap.md) | data_and_numbers | - |
| `dn-status-pill-ring` | [cin-dn-status-pill-ring](techniques/cin-dn-status-pill-ring.md) | data_and_numbers | status-pill-ui-block |
| `dn-metric-cold-open` | [cin-dn-metric-cold-open](techniques/cin-dn-metric-cold-open.md) | data_and_numbers | - |
| `dn-tucked-unit-label` | [cin-dn-tucked-unit-label](techniques/cin-dn-tucked-unit-label.md) | data_and_numbers | - |
| `dn-hero-bar-pullback` | [cin-dn-hero-bar-pullback](techniques/cin-dn-hero-bar-pullback.md) | data_and_numbers | - |
| `dn-answer-card-bars` | [cin-dn-answer-card-bars](techniques/cin-dn-answer-card-bars.md) | data_and_numbers | - |
| `dn-line-draw-tracked-head` | [cin-dn-line-draw-tracked-head](techniques/cin-dn-line-draw-tracked-head.md) | data_and_numbers | chart-line-head-dot |
| `dn-bar-sweep-lit-caps` | [cin-dn-bar-sweep-lit-caps](techniques/cin-dn-bar-sweep-lit-caps.md) | data_and_numbers | lit-cap-bars |
| `dn-linked-control-counters` | [cin-dn-linked-control-counters](techniques/cin-dn-linked-control-counters.md) | data_and_numbers | slider-linked-counters |
| `dn-flag-then-select` | [cin-dn-flag-then-select](techniques/cin-dn-flag-then-select.md) | data_and_numbers | - |
| `dn-row-cascade-value-swap` | [cin-dn-row-cascade-value-swap](techniques/cin-dn-row-cascade-value-swap.md) | data_and_numbers | row-staggered-scan-wipe |
| `dn-digit-reel-detent` | [cin-dn-digit-reel-detent](techniques/cin-dn-digit-reel-detent.md) | data_and_numbers | detent-single-column-overshoot |
| `dn-ring-gauge-sync` | [cin-dn-ring-gauge-sync](techniques/cin-dn-ring-gauge-sync.md) | data_and_numbers | - |
| `dn-delta-chip-compare` | [cin-dn-delta-chip-compare](techniques/cin-dn-delta-chip-compare.md) | data_and_numbers | - |
| `dn-unit-grid-tally` | [cin-dn-unit-grid-tally](techniques/cin-dn-unit-grid-tally.md) | data_and_numbers | - |
| `dn-area-ratio-compare` | [cin-dn-area-ratio-compare](techniques/cin-dn-area-ratio-compare.md) | data_and_numbers | - |
| `pd-device-rise-on-cut` | [cin-pd-device-rise-on-cut](techniques/cin-pd-device-rise-on-cut.md) | product_demo | - |
| `pd-tilted-plane-flattens` | [cin-pd-tilted-plane-flattens](techniques/cin-pd-tilted-plane-flattens.md) | product_demo | perspective-plane-showcase, focus-pull-between-planes |
| `pd-hard-swap-on-cause` | [cin-pd-hard-swap-on-cause](techniques/cin-pd-hard-swap-on-cause.md) | product_demo | - |
| `pd-blur-resolve-load` | [cin-pd-blur-resolve-load](techniques/cin-pd-blur-resolve-load.md) | product_demo | - |
| `pd-agent-status-then-answer` | [cin-pd-agent-status-then-answer](techniques/cin-pd-agent-status-then-answer.md) | product_demo | - |
| `pd-headline-becomes-input` | [cin-pd-headline-becomes-input](techniques/cin-pd-headline-becomes-input.md) | product_demo | - |
| `pd-fast-prompt-true-scale` | [cin-pd-fast-prompt-true-scale](techniques/cin-pd-fast-prompt-true-scale.md) | product_demo | - |
| `pd-mark-docks-into-app` | [cin-pd-mark-docks-into-app](techniques/cin-pd-mark-docks-into-app.md) | product_demo | - |
| `pd-ui-native-transitions` | [cin-pd-ui-native-transitions](techniques/cin-pd-ui-native-transitions.md) | product_demo | - |
| `pd-shared-element-page` | [cin-pd-shared-element-page](techniques/cin-pd-shared-element-page.md) | product_demo | - |
| `pd-flick-scroll-lands-target` | dup of `shot-brake-scroll` | product_demo | Add its numbers: a flick enters at about 54 px/f with decay 0.943 (tau 17 f), about 920 px, readable after 49 f and at rest in about 76 f; in-shot, ramp 28-40 f to a peak of 35-60 px/f (cap 60), decay 0.93 for a form section up to 0.98 for a long reel; land the target about 15 percent from the top or centred; rows are unreadable above 3 px/f. |
| `pd-single-control-hero` | [cin-pd-single-control-hero](techniques/cin-pd-single-control-hero.md) | product_demo | - |
| `pd-drag-assets-skeleton-fill` | [cin-pd-drag-assets-skeleton-fill](techniques/cin-pd-drag-assets-skeleton-fill.md) | product_demo | - |
| `pd-pin-field-pullback` | [cin-pd-pin-field-pullback](techniques/cin-pd-pin-field-pullback.md) | product_demo | - |
| `pd-before-after-drag-wipe` | dup of `shot-before-after-scrub` | product_demo | Add its numbers: the cursor reaches the handle over 36-48 f (0.6-0.8 s) on an out-ease, presses (4 f down, 8 f recoil) a 40 px round handle on a 2 px line, drags about 1,100 px in 60 f (1.0 s) peaking near 52 px/f, optionally pausing at the midpoint up to 24 f (0.4 s) under a breath push; values that differ sit on separate layers so halves are never crossfaded. |
| `pd-page-runway-flyover` | dup of `shot-tilted-plane-glide` | product_demo | Add its numbers: plane tilted 55 degrees at perspective 1200 px, 75 percent of frame width and 2x frame height, fading to the stage colour at the horizon (about 25 percent down); page speed ramps linearly 6 to 30 px/f over 54 f (0.9 s) then 36 px/f to a hard cut on the fastest frame (80 f = 1.33 s in all, about 1,900 px), motion blur on throughout, one caption line in the stage above the horizon; once per film. |
| `pd-ghost-suggestion-accept` | [cin-pd-ghost-suggestion-accept](techniques/cin-pd-ghost-suggestion-accept.md) | product_demo | left-to-right-colour-front |
| `pd-live-filter-narrows` | [cin-pd-live-filter-narrows](techniques/cin-pd-live-filter-narrows.md) | product_demo | live-layout-reflow |
| `pd-chart-scrub-readout` | [cin-pd-chart-scrub-readout](techniques/cin-pd-chart-scrub-readout.md) | product_demo | data-bound-scrub-readout |
| `pd-terminal-burst-output` | [cin-pd-terminal-burst-output](techniques/cin-pd-terminal-burst-output.md) | product_demo | burst-printed-output-schedule |
| `pd-diff-hunks-apply` | [cin-pd-diff-hunks-apply](techniques/cin-pd-diff-hunks-apply.md) | product_demo | diff-hunk-view |
| `pd-presence-cursors` | dup of `shot-collab-cursors` | product_demo | Add its numbers: at most three cursors (not five), each with a name flag 14 px right and 18 px below the tip, travel 6-14 px/f on a smooth ease with a bow of 0.15-0.25, arrivals and presses at least 6 f (0.1 s) apart, a wander of at most 6 px every 24 f (0.4 s), one action every 30-50 f (0.5-0.83 s) across all cursors, the newest edit outlined 24 f (0.4 s), avatars stacking in the corner. |
| `le-mark-slide-name-follow` | [cin-le-mark-slide-name-follow](techniques/cin-le-mark-slide-name-follow.md) | logo_and_end_card | - |
| `le-reverse-type-recentre` | [cin-le-reverse-type-recentre](techniques/cin-le-reverse-type-recentre.md) | logo_and_end_card | reverse-order-letter-reveal |
| `le-macro-pullout-breathe` | [cin-le-macro-pullout-breathe](techniques/cin-le-macro-pullout-breathe.md) | logo_and_end_card | true-motion-blur-native |
| `le-slam-spin-pullout` | [cin-le-slam-spin-pullout](techniques/cin-le-slam-spin-pullout.md) | logo_and_end_card | - |
| `le-seed-stroke-build` | [cin-le-seed-stroke-build](techniques/cin-le-seed-stroke-build.md) | logo_and_end_card | - |
| `le-gooey-merge-to-mark` | [cin-le-gooey-merge-to-mark](techniques/cin-le-gooey-merge-to-mark.md) | logo_and_end_card | metaball-gooey-threshold |
| `le-clone-stack-morph` | [cin-le-clone-stack-morph](techniques/cin-le-clone-stack-morph.md) | logo_and_end_card | - |
| `le-device-becomes-mark` | [cin-le-device-becomes-mark](techniques/cin-le-device-becomes-mark.md) | logo_and_end_card | - |
| `le-words-part-url-types` | [cin-le-words-part-url-types](techniques/cin-le-words-part-url-types.md) | logo_and_end_card | - |
| `le-card-to-pill-flank` | [cin-le-card-to-pill-flank](techniques/cin-le-card-to-pill-flank.md) | logo_and_end_card | - |
| `le-accordion-cta-collapse` | [cin-le-accordion-cta-collapse](techniques/cin-le-accordion-cta-collapse.md) | logo_and_end_card | focus-pull-between-planes |
| `le-stage-clears-to-brand` | [cin-le-stage-clears-to-brand](techniques/cin-le-stage-clears-to-brand.md) | logo_and_end_card | - |
| `le-bookend-replay` | [cin-le-bookend-replay](techniques/cin-le-bookend-replay.md) | logo_and_end_card | - |
| `le-living-hold` | [cin-le-living-hold](techniques/cin-le-living-hold.md) | logo_and_end_card | - |
| `le-strobe-sting` | [cin-le-strobe-sting](techniques/cin-le-strobe-sting.md) | logo_and_end_card | grid-cell-reflow |
| `le-hot-to-neutral-cool` | [cin-le-hot-to-neutral-cool](techniques/cin-le-hot-to-neutral-cool.md) | logo_and_end_card | - |
| `le-mark-glint-turn` | [cin-le-mark-glint-turn](techniques/cin-le-mark-glint-turn.md) | logo_and_end_card | - |
| `le-mark-ticks-in-lockup` | [cin-le-mark-ticks-in-lockup](techniques/cin-le-mark-ticks-in-lockup.md) | logo_and_end_card | - |
| `cl-mono-one-accent` | [cin-cl-mono-one-accent](techniques/cin-cl-mono-one-accent.md) | color_and_light | - |
| `cl-one-hue-light-ramp` | [cin-cl-one-hue-light-ramp](techniques/cin-cl-one-hue-light-ramp.md) | color_and_light | hard-edged-gradient-band-field |
| `cl-accent-claim-grounds` | [cin-cl-accent-claim-grounds](techniques/cin-cl-accent-claim-grounds.md) | color_and_light | - |
| `cl-inversion-card` | [cin-cl-inversion-card](techniques/cin-cl-inversion-card.md) | color_and_light | soft-colour-falloff-ring |
| `cl-theme-flip-in-motion` | dup of `shot-theme-switch` | color_and_light | cinetic's numbers: the flip takes 6 f (0.1 s) with the mask edge moving linearly top-first (the top leads by about 2 f; frame luma runs about 40, 140, 205, 235), the camera keeps its cruise speed through it (it only works on a moving shot, a static one reads as a plain crossfade), and the stage swaps from the dark grid to the light studio on the same span so it doubles as the dark-to-light act change. |
| `cl-context-palette-shift` | [cin-cl-context-palette-shift](techniques/cin-cl-context-palette-shift.md) | color_and_light | - |
| `cl-ink-resolve` | [cin-cl-ink-resolve](techniques/cin-cl-ink-resolve.md) | color_and_light | per-word-colour-resolve |
| `cl-accent-on-newest` | [cin-cl-accent-on-newest](techniques/cin-cl-accent-on-newest.md) | color_and_light | newest-glyph-accent-wake |
| `cl-accent-hit-envelope` | [cin-cl-accent-hit-envelope](techniques/cin-cl-accent-hit-envelope.md) | color_and_light | - |
| `cl-specular-sweep` | dup of `shot-light-sweep` | color_and_light | cinetic's numbers: the band is about 40 % of the text height wide (about 30 % of the width for a logo), peak opacity up to 0.9, sweeps from -20 % to 120 % of the element width in 36 f (0.6 s) on a smooth ease, starting 6-10 f (0.1-0.17 s) after the element lands and only once per shot; a looping 'working' label uses a 120 px band on a 60 f (1 s) linear period and stops on the frame the state resolves; the sheen stays inside the glyphs, no halo. |
| `cl-rim-light-sweep` | [cin-cl-rim-light-sweep](techniques/cin-cl-rim-light-sweep.md) | color_and_light | svg-path-write-on, per-side-coloured-halo |
| `cl-tone-band-fill` | dup of `shot-gradient-word-sweep` | color_and_light | cinetic's numbers: the fill band runs final ink, light accent tint, accent, stage colour; a word sweep takes 32 f (0.53 s) on a smooth ease with the front peaking near 25 px per frame; a URL takes 42 f (0.7 s) easing into the final ink with the path span lagging 8-12 f (0.13-0.2 s); accent letters in a tagline step ink to accent with a 2 f stagger after the line lands; a logo mark wipes bottom-up in 8 f (0.13 s) then its tone scrolls for 36 f (0.6 s) and settles on solid accent. The type itself stays still, only the fill travels. |
| `cl-living-stage` | [cin-cl-living-stage](techniques/cin-cl-living-stage.md) | color_and_light | - |
| `cl-light-swell-bridge` | [cin-cl-light-swell-bridge](techniques/cin-cl-light-swell-bridge.md) | color_and_light | - |
| `cl-rising-wash-carrier` | [cin-cl-rising-wash-carrier](techniques/cin-cl-rising-wash-carrier.md) | color_and_light | - |
| `cl-drain-stage-keep-hero` | [cin-cl-drain-stage-keep-hero](techniques/cin-cl-drain-stage-keep-hero.md) | color_and_light | - |
| `cl-tilt-linked-sheen` | [cin-cl-tilt-linked-sheen](techniques/cin-cl-tilt-linked-sheen.md) | color_and_light | rotation-linked-sheen |
| `cl-duotone-until-featured` | [cin-cl-duotone-until-featured](techniques/cin-cl-duotone-until-featured.md) | color_and_light | - |
| `cl-key-light-edge-hairline` | [cin-cl-key-light-edge-hairline](techniques/cin-cl-key-light-edge-hairline.md) | color_and_light | rotation-linked-edge-angle |
| `cl-brightness-rides-move` | [cin-cl-brightness-rides-move](techniques/cin-cl-brightness-rides-move.md) | color_and_light | true-motion-blur-native |
| `cl-read-state-tone-ladder` | [cin-cl-read-state-tone-ladder](techniques/cin-cl-read-state-tone-ladder.md) | color_and_light | - |
| `cl-graphic-blurs-into-stage` | [cin-cl-graphic-blurs-into-stage](techniques/cin-cl-graphic-blurs-into-stage.md) | color_and_light | - |
| `cl-rolling-band-flood` | [cin-cl-rolling-band-flood](techniques/cin-cl-rolling-band-flood.md) | color_and_light | - |
| `cl-hue-tinted-shadow` | [cin-cl-hue-tinted-shadow](techniques/cin-cl-hue-tinted-shadow.md) | color_and_light | - |
| `cl-type-solidity-arc` | [cin-cl-type-solidity-arc](techniques/cin-cl-type-solidity-arc.md) | color_and_light | - |
| `tx-speed-gated-motion-blur` | [cin-tx-speed-gated-motion-blur](techniques/cin-tx-speed-gated-motion-blur.md) | texture_and_finish | true-motion-blur-native |
| `tx-on-twos-cadence` | [cin-tx-on-twos-cadence](techniques/cin-tx-on-twos-cadence.md) | texture_and_finish | - |
| `tx-mixed-media-grade` | [cin-tx-mixed-media-grade](techniques/cin-tx-mixed-media-grade.md) | texture_and_finish | - |
| `tx-low-luma-photo-plate` | [cin-tx-low-luma-photo-plate](techniques/cin-tx-low-luma-photo-plate.md) | texture_and_finish | - |
| `tx-global-grain` | [cin-tx-global-grain](techniques/cin-tx-global-grain.md) | texture_and_finish | - |
| `tx-ramp-masked-stipple` | [cin-tx-ramp-masked-stipple](techniques/cin-tx-ramp-masked-stipple.md) | texture_and_finish | ramp-masked-stipple |
| `tx-dot-matrix-silhouette` | [cin-tx-dot-matrix-silhouette](techniques/cin-tx-dot-matrix-silhouette.md) | texture_and_finish | - |
| `tx-scanline-transmute` | [cin-tx-scanline-transmute](techniques/cin-tx-scanline-transmute.md) | texture_and_finish | keyframed-polygon-mask |
| `tx-locked-mosaic` | [cin-tx-locked-mosaic](techniques/cin-tx-locked-mosaic.md) | texture_and_finish | pixelate-mosaic-fx |
| `tx-ring-field` | [cin-tx-ring-field](techniques/cin-tx-ring-field.md) | texture_and_finish | gradient-stroke |
| `tx-brushed-micro-streaks` | [cin-tx-brushed-micro-streaks](techniques/cin-tx-brushed-micro-streaks.md) | texture_and_finish | overlay-blend-mode |
| `tx-glyph-grid-pulse` | [cin-tx-glyph-grid-pulse](techniques/cin-tx-glyph-grid-pulse.md) | texture_and_finish | grid-displacement-pulse |
| `tx-gobo-studio-shadows` | [cin-tx-gobo-studio-shadows](techniques/cin-tx-gobo-studio-shadows.md) | texture_and_finish | - |
| `tx-fog-floor` | [cin-tx-fog-floor](techniques/cin-tx-fog-floor.md) | texture_and_finish | perspective-plane-showcase |
| `tx-micro-tick-ui-sound` | [cin-tx-micro-tick-ui-sound](techniques/cin-tx-micro-tick-ui-sound.md) | texture_and_finish | - |
| `tx-surface-edge-finish` | [cin-tx-surface-edge-finish](techniques/cin-tx-surface-edge-finish.md) | texture_and_finish | - |
| `tx-feathered-edge-mask` | [cin-tx-feathered-edge-mask](techniques/cin-tx-feathered-edge-mask.md) | texture_and_finish | - |
| `tx-mosaic-resolve` | [cin-tx-mosaic-resolve](techniques/cin-tx-mosaic-resolve.md) | texture_and_finish | pixelate-mosaic-fx |
| `tx-wireframe-scan-build` | [cin-tx-wireframe-scan-build](techniques/cin-tx-wireframe-scan-build.md) | texture_and_finish | wireframe-render-of-ui |
| `tx-halftone-shading` | [cin-tx-halftone-shading](techniques/cin-tx-halftone-shading.md) | texture_and_finish | - |
| `lc-swarm-cluster-burst` | [cin-lc-swarm-cluster-burst](techniques/cin-lc-swarm-cluster-burst.md) | layout_and_composition | card-swarm-radial-rig, true-motion-blur-native |
| `lc-arc-carousel` | [cin-lc-arc-carousel](techniques/cin-lc-arc-carousel.md) | layout_and_composition | arc-carousel-rig |
| `lc-hero-flips-to-inline-glyph` | [cin-lc-hero-flips-to-inline-glyph](techniques/cin-lc-hero-flips-to-inline-glyph.md) | layout_and_composition | inline-glyph-slot |
| `lc-headline-over-ghost-ui` | [cin-lc-headline-over-ghost-ui](techniques/cin-lc-headline-over-ghost-ui.md) | layout_and_composition | - |
| `lc-icon-ragged-stack` | [cin-lc-icon-ragged-stack](techniques/cin-lc-icon-ragged-stack.md) | layout_and_composition | - |
| `lc-hub-spoke-diagram` | dup of `shot-source-hub-connect` | layout_and_composition | cinetic adds: a 64-96 px icon tile inside two thin rings at 1.8x and 2.8x its size (1.5 px strokes at 15 % opacity), a 70-degree comet streak orbiting the outer ring at 1.5 deg/f (a quarter turn a second), inputs left and outputs right entering 6 f apart (12 f, 10 px rise), connectors drawing over 16 f, hold 120-200 f, at most five chips per side. |
| `lc-mark-as-inline-word` | [cin-lc-mark-as-inline-word](techniques/cin-lc-mark-as-inline-word.md) | layout_and_composition | inline-glyph-slot |
| `lc-negative-space-caption` | [cin-lc-negative-space-caption](techniques/cin-lc-negative-space-caption.md) | layout_and_composition | - |
| `lc-opposite-corner-relay` | [cin-lc-opposite-corner-relay](techniques/cin-lc-opposite-corner-relay.md) | layout_and_composition | - |
| `lc-one-centred-subject` | [cin-lc-one-centred-subject](techniques/cin-lc-one-centred-subject.md) | layout_and_composition | - |
| `lc-symmetric-flank` | [cin-lc-symmetric-flank](techniques/cin-lc-symmetric-flank.md) | layout_and_composition | - |
| `lc-subtract-to-one` | [cin-lc-subtract-to-one](techniques/cin-lc-subtract-to-one.md) | layout_and_composition | - |
| `lc-gap-open-insert` | [cin-lc-gap-open-insert](techniques/cin-lc-gap-open-insert.md) | layout_and_composition | inline-glyph-slot |
| `lc-live-split-view` | [cin-lc-live-split-view](techniques/cin-lc-live-split-view.md) | layout_and_composition | - |
| `lc-bento-cell-takeover` | [cin-lc-bento-cell-takeover](techniques/cin-lc-bento-cell-takeover.md) | layout_and_composition | grid-cell-reflow |
| `lc-vertical-band-stack` | [cin-lc-vertical-band-stack](techniques/cin-lc-vertical-band-stack.md) | layout_and_composition | - |
| `ps-breath-envelope` | [cin-ps-breath-envelope](techniques/cin-ps-breath-envelope.md) | pacing_structure | - |
| `ps-locked-camera-holds` | [cin-ps-locked-camera-holds](techniques/cin-ps-locked-camera-holds.md) | pacing_structure | - |
| `ps-one-long-hold` | [cin-ps-one-long-hold](techniques/cin-ps-one-long-hold.md) | pacing_structure | - |
| `ps-silent-sign-off` | [cin-ps-silent-sign-off](techniques/cin-ps-silent-sign-off.md) | pacing_structure | - |
| `ps-four-sequence-launch` | [cin-ps-four-sequence-launch](techniques/cin-ps-four-sequence-launch.md) | pacing_structure | - |
| `ps-image-act-then-type-act` | [cin-ps-image-act-then-type-act](techniques/cin-ps-image-act-then-type-act.md) | pacing_structure | - |
| `ps-luma-act-map` | [cin-ps-luma-act-map](techniques/cin-ps-luma-act-map.md) | pacing_structure | - |
| `ps-oner-morph-chain` | [cin-ps-oner-morph-chain](techniques/cin-ps-oner-morph-chain.md) | pacing_structure | svg-icon-morph-chain |
| `ps-single-camera-journey` | [cin-ps-single-camera-journey](techniques/cin-ps-single-camera-journey.md) | pacing_structure | perspective-plane-showcase |
| `ps-continuity-thread` | [cin-ps-continuity-thread](techniques/cin-ps-continuity-thread.md) | pacing_structure | svg-path-write-on |
| `ps-faster-each-repeat` | [cin-ps-faster-each-repeat](techniques/cin-ps-faster-each-repeat.md) | pacing_structure | - |
| `ps-fixed-ask-variable-answer` | [cin-ps-fixed-ask-variable-answer](techniques/cin-ps-fixed-ask-variable-answer.md) | pacing_structure | - |
| `ps-beat-quantized-chunks` | [cin-ps-beat-quantized-chunks](techniques/cin-ps-beat-quantized-chunks.md) | pacing_structure | motion-block-word-cues |
| `ps-empty-ground-after-cut` | [cin-ps-empty-ground-after-cut](techniques/cin-ps-empty-ground-after-cut.md) | pacing_structure | - |
| `ps-music-hole-slam` | dup of `cinematic-silence-before-hit` | pacing_structure | cinetic adds: the bed sucks down 12-24 f (0.2-0.4 s) before the statement (a 10-20 dB drop or the sub going fully silent; for a line, 2-4 beats with drums and bass out and only the pad holding), the return lands on a downbeat within +/-1 f of a picture event (the cut, a mask click, a reveal), the card's own sound stays tiny, and only 2-4 such holes per minute, the deepest before the hero cut. |
| `ps-score-mapped-to-acts` | [cin-ps-score-mapped-to-acts](techniques/cin-ps-score-mapped-to-acts.md) | pacing_structure | - |
| `ps-silent-ui-steady-bed` | [cin-ps-silent-ui-steady-bed](techniques/cin-ps-silent-ui-steady-bed.md) | pacing_structure | - |
| `ps-accelerando-to-climax` | dup of `accelerating-cut-length-ramp` | pacing_structure | cinetic adds: the last 5-7 shots before the climax step to about 0.7x each (4, 3, 2, 1.5, 1, 1 beats at 120 BPM = 120, 90, 60, 45, 30, 30 f), text only on shots long enough for the copy rule while text-free shots go down to 24 f, each shot's exit ramp on its last 40 % (ease_in_cubic), the score stepping groove to build under it, then one 12-15 f (0.2-0.25 s) freeze on true silence before the climax move starts at full speed on the next downbeat. |
| `ps-loop-seam-on-motion-peak` | [cin-ps-loop-seam-on-motion-peak](techniques/cin-ps-loop-seam-on-motion-peak.md) | pacing_structure | - |
| `ps-silence-first-sound` | [cin-ps-silence-first-sound](techniques/cin-ps-silence-first-sound.md) | pacing_structure | - |
| `ps-long-tail-beat-lengths` | [cin-ps-long-tail-beat-lengths](techniques/cin-ps-long-tail-beat-lengths.md) | pacing_structure | - |
| `ps-direction-per-act` | [cin-ps-direction-per-act](techniques/cin-ps-direction-per-act.md) | pacing_structure | - |
| `ps-machine-grid-human-gaps` | [cin-ps-machine-grid-human-gaps](techniques/cin-ps-machine-grid-human-gaps.md) | pacing_structure | - |
| `mi-focus-ring-pop-or-trim` | [cin-mi-focus-ring-pop-or-trim](techniques/cin-mi-focus-ring-pop-or-trim.md) | micro_interaction | stroke-erase-from-tail |
| `mi-in-place-char-rewrite` | [cin-mi-in-place-char-rewrite](techniques/cin-mi-in-place-char-rewrite.md) | micro_interaction | per-character-overwrite |
| `mi-anticipation-dip-unlock` | [cin-mi-anticipation-dip-unlock](techniques/cin-mi-anticipation-dip-unlock.md) | micro_interaction | - |
| `mi-pre-event-tell` | [cin-mi-pre-event-tell](techniques/cin-mi-pre-event-tell.md) | micro_interaction | - |
| `mi-chip-bloom` | [cin-mi-chip-bloom](techniques/cin-mi-chip-bloom.md) | micro_interaction | - |
| `mi-shape-handoff-morph` | [cin-mi-shape-handoff-morph](techniques/cin-mi-shape-handoff-morph.md) | micro_interaction | - |
| `mi-guide-cursor-hover-press` | [cin-mi-guide-cursor-hover-press](techniques/cin-mi-guide-cursor-hover-press.md) | micro_interaction | - |
| `mi-velocity-stretch-dot` | [cin-mi-velocity-stretch-dot](techniques/cin-mi-velocity-stretch-dot.md) | micro_interaction | velocity-stretch-capsule |
| `mi-shared-highlight-walk` | [cin-mi-shared-highlight-walk](techniques/cin-mi-shared-highlight-walk.md) | micro_interaction | - |
| `mi-stretch-tab-indicator` | [cin-mi-stretch-tab-indicator](techniques/cin-mi-stretch-tab-indicator.md) | micro_interaction | - |
| `mi-radial-dash-burst` | [cin-mi-radial-dash-burst](techniques/cin-mi-radial-dash-burst.md) | micro_interaction | - |
| `mi-launch-hop` | [cin-mi-launch-hop](techniques/cin-mi-launch-hop.md) | micro_interaction | - |
| `mi-two-beat-confirm-cascade` | [cin-mi-two-beat-confirm-cascade](techniques/cin-mi-two-beat-confirm-cascade.md) | micro_interaction | - |
| `mi-spinner-to-check` | [cin-mi-spinner-to-check](techniques/cin-mi-spinner-to-check.md) | micro_interaction | - |
| `mi-send-ghost-handoff` | [cin-mi-send-ghost-handoff](techniques/cin-mi-send-ghost-handoff.md) | micro_interaction | - |
| `mi-drag-lift-seat` | [cin-mi-drag-lift-seat](techniques/cin-mi-drag-lift-seat.md) | micro_interaction | - |
| `mi-badge-count-bump` | [cin-mi-badge-count-bump](techniques/cin-mi-badge-count-bump.md) | micro_interaction | - |
| `mi-field-focus-caret` | [cin-mi-field-focus-caret](techniques/cin-mi-field-focus-caret.md) | micro_interaction | - |
| `mi-cursor-glyph-context` | [cin-mi-cursor-glyph-context](techniques/cin-mi-cursor-glyph-context.md) | micro_interaction | cursor-glyph-set |
| `mi-drag-select-highlight` | [cin-mi-drag-select-highlight](techniques/cin-mi-drag-select-highlight.md) | micro_interaction | - |
| `d3-card-fan-bury-scatter` | [cin-d3-card-fan-bury-scatter](techniques/cin-d3-card-fan-bury-scatter.md) | depth_and_3d | card-swarm-radial-rig, true-motion-blur-native |
| `d3-pinned-label-world-swap` | [cin-d3-pinned-label-world-swap](techniques/cin-d3-pinned-label-world-swap.md) | depth_and_3d | tracked-point-callout-pin |
| `d3-spotlit-tilted-object` | [cin-d3-spotlit-tilted-object](techniques/cin-d3-spotlit-tilted-object.md) | depth_and_3d | perspective-plane-showcase |
| `d3-orbit-ring-collapse` | [cin-d3-orbit-ring-collapse](techniques/cin-d3-orbit-ring-collapse.md) | depth_and_3d | orbit-ring-carousel |
| `d3-fold-out-channel` | [cin-d3-fold-out-channel](techniques/cin-d3-fold-out-channel.md) | depth_and_3d | folded-panel-3d |
| `d3-flip-face-swap` | dup of `shot-card-flip-reveal` | depth_and_3d | cinetic adds: wrapper perspective about 3.5x the object width, turn 0 to 180 deg in 10 f (0.17 s) ease_in_out_expo with brightness 0.7 + 0.3/cos/ and a strong transient on the edge-on frame (about f5), then shrink to 0.38 and travel 290 px in 16 f (0.27 s) overlapping by 4 f; a deck of logo cards flips 6 f (0.1 s) each, 6 f apart (whole group within 30 f, 0.5 s) and moves into slots at 0.25 scale over 12 f (0.2 s) with labels blurring in over 8 f. |
| `d3-peek-launch-recede` | [cin-d3-peek-launch-recede](techniques/cin-d3-peek-launch-recede.md) | depth_and_3d | - |
| `d3-coin-edge-to-face` | [cin-d3-coin-edge-to-face](techniques/cin-d3-coin-edge-to-face.md) | depth_and_3d | - |
| `d3-extruded-slab-orbit` | [cin-d3-extruded-slab-orbit](techniques/cin-d3-extruded-slab-orbit.md) | depth_and_3d | - |
| `d3-impact-morph-stretch` | [cin-d3-impact-morph-stretch](techniques/cin-d3-impact-morph-stretch.md) | depth_and_3d | floor-ripple-grid |
| `d3-icon-lift-to-hero` | [cin-d3-icon-lift-to-hero](techniques/cin-d3-icon-lift-to-hero.md) | depth_and_3d | - |
| `d3-cube-turn-face` | [cin-d3-cube-turn-face](techniques/cin-d3-cube-turn-face.md) | depth_and_3d | card-flip-3d |
| `d3-press-tilt-swap` | [cin-d3-press-tilt-swap](techniques/cin-d3-press-tilt-swap.md) | depth_and_3d | card-flip-3d |
| `d3-exploded-layer-stack` | dup of `shot-exploded-layers` | depth_and_3d | cinetic adds: a three-quarter turn (yaw -28 deg, pitch 14 deg) over 36 f (0.6 s), layers separating 80-120 px each over 24 f (0.4 s) with a 12 f (0.2 s) stagger and a neutral shadow on the layer below (alpha 0.18, blur 20 px), a hold up to 48 f (0.8 s) on a 0.05 deg/f yaw drift while one layer animates its own state, then collapse in 16 f (0.27 s) with a 1.5 % camera punch on contact and the flatten over 30 f (0.5 s) starting 10 f before the collapse ends. |
