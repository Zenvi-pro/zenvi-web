---
id: cin-pd-headline-becomes-input
kind: technique
summary: "When a type-led film turns to the product, a caret opens in the headline and widens into the input bar."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, add_motion_block_tool, add_sfx_tool, set_keyframes_tool]
pace: medium
mood: [seamless, clever, product]
aspect: ["16:9", "1:1"]
pairs_with: [cin-pd-fast-prompt-true-scale, cin-ui-container-morph, prompt-bar-typing-hero]
avoid_with: [cin-ui-genie-launch-from-icon, kinetic-word-pop]
needs: []
drawn: cinetic
---

# Headline becomes the product input

cinetic `pd-headline-becomes-input` · Product demo · signature · energy medium · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Without a cut the headline turns into the product: a caret appears in the gap between two words, swells into a capsule and widens into the input bar that shoves the words aside, or the sentence inside a card dissolves while the card reshapes into the input.

Use when: Bridging from message to demo in a type-led film; the product's core surface is an input, search or command bar.

## Build it in Zenvi

1. The headline as two separate title clips with a gap: `add_title_tool {"text": "<word L>", "screen_position": "center", "position_seconds": 0.0, "duration_seconds": 3.0, "track": "3"}` and the same for word R. A third clip is the slot: a solid block `add_title_tool {"text": " ", "background_color": "<accent>", "fit_text": false, "position_seconds": 0.5, "duration_seconds": 2.5, "track": "2"}`.
2. Caret: slot `scale_y` 0 to the line height over 6 f (0.1 s) `ease_out_expo`, hold 8 f (0.13 s), thicken to a 36 px capsule over 14 f (0.23 s), then widen to about 92 % of frame over 60 f (1.0 s) on `ease_in_out_expo` (edge peak about 50 px/f, with `motion_blur`), its fill going straight to the opaque input colour.
3. Bind the words to the slot edges: give both word clips `location_x` keyframes that follow the SAME curve as the slot's edge, minus a gap (word L left, word R right), and once they pass 20 px/f fade them out on `ease_in_out_sine` as they leave the frame.
4. Contents fill the bar container-first, left to right 4 f (0.07 s) apart, each over 12 f (0.2 s) with a 6 px rise: `add_motion_block_tool {"block": "prompt_bar", "params": {"placeholder": "<ask>", "cursor": true}, "position_seconds": 1.8, "duration_seconds": 5.0}`; the primary button fills last on a 16 f (0.27 s) linear ramp.
5. If the sentence sits in a card: word exits 6 f (0.1 s) apart, card height to the input's over 30 f (0.5 s) `ease_out_expo`, placeholder in over 16 f (0.27 s).
6. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 1.3, "gain_db": -20}`.

## Timing & taste rules

- cinetic's timing (60 fps): Caret 6 f (0.10 s), hold 8 f (0.13 s), capsule 14 f (0.23 s), widen 60 f (1.00 s) on ease_out_cubic (a short bar: 23 f (0.38 s) in all on ease_out_expo); contents 12 f (0.20 s) each at a 4 f (0.07 s) stagger, button fill 16 f (0.27 s) linear. Card variant: word exits 6 f (0.10 s) apart, resize 30 f (0.50 s) on ease_out_expo, placeholder 16 f (0.27 s).
- Caret 6 f (0.1 s), hold 8 f (0.13 s), capsule 14 f (0.23 s), widen 60 f (1.0 s); a short bar takes 23 f (0.38 s) in all on ease_out_expo.
- Contents 12 f (0.2 s) each at a 4 f (0.07 s) stagger; button fill 16 f (0.27 s) linear.
- Words fade only once they pass 20 px/f, never before.
- Go straight to an opaque bar over a busy backdrop.

## Sound for it

A whoosh_short at -20 dB under the widening and one soft ui_tap at -24 dB when the bar settles.

## Common mistakes

- The product is not input-led, or the headline has no natural gap for the caret.
- A translucent bar over a busy backdrop: go straight to opaque.
- Tweening the words separately from the slot: they must ride its edges.
- Avoid when: The product is not input-led; the headline has no natural gap; the bar would have to stay translucent over a busy backdrop (go straight to opaque).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-headline-becomes-input`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
