---
id: cin-cl-accent-on-newest
kind: technique
summary: "When a prompt types or a line builds: the newest character or word wears the accent a beat, then settles to neutral."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_kinetic_title_tool, set_keyframes_tool]
pace: medium
mood: [alive, leading, precise]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [prompt-bar-typing-hero, cin-cl-read-state-tone-ladder, kinetic-typewriter]
avoid_with: [cin-cl-accent-hit-envelope, cin-cl-mono-one-accent]
needs: [newest-glyph-accent-wake]
drawn: cinetic
---

# Accent on the newest arrival

cinetic `cl-accent-on-newest` · Colour and light · workhorse · energy medium · formats feature, walkthrough, launch, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Whatever just arrived (a typed character, a snapped word, a generated pill) wears the accent for a moment and then settles to neutral, so a short coloured wake leads the eye.

Use when: Prompts typing, statements building word by word, AI-generated items appearing, or any build where the newest piece should lead.

## Build it in Zenvi

1. Typing: `add_motion_block_tool {"block": "text_scramble", "position_seconds": 1.0, "duration_seconds": 3.0, "params": {"text": "Build me a launch film", "glyphs": "letters", "highlight": true}, "accent": "<accent>"}`: the accent block rides the decode front, which is the nearest thing to a coloured wake behind the caret.
2. Word-by-word build: `add_kinetic_title_tool {"text": "Make every frame count", "style": "editorial", "animation": "rise", "emphasis": ["count"], "accent": "<accent>", "ink": "#ffffff", "stagger_seconds": 0.27, "position_seconds": 1.0, "duration_seconds": 3.0}`: the last word keeps the accent until the cut.
3. A generated pill or card: place it with its normal block, then lay an accent-tinted copy of its shape on top and fade it out: `set_keyframes_tool {"timeline_clip_id": "<tint_copy>", "property": "alpha", "points": [{"seconds": 2.0, "value": 1}, {"seconds": 2.5, "value": 0, "ease": "ease_out_expo"}]}` (20-40 f, 0.33-0.67 s).
4. One accent hue only, no multi-stop hue cycle, no bloom.

Fallback: Zenvi cannot colour each glyph by its age: the typing wake is approximated by the text_scramble decode front, and word builds keep the accent on the last emphasis word only. Do not stack tinted duplicates for every character.

## Timing & taste rules

- cinetic's timing (60 fps): Glyph decay takes 12-16 f (0.27 s) on linear. A word wave takes 16-20 f (0.33 s) per word with an 8-12 f (0.20 s) stagger. A step holds 16-20 f (0.33 s) per word. An object's tint resolves over 20-40 f (0.67 s) on ease_out_expo.
- Glyph accent decays over 12-16 f (0.2-0.27 s), linear; at 1-1.7 chars per frame that leaves a wake of 10-20 characters.
- Word wave: a word is grey for 4 f, accent at about 8 f, ink by 16-20 f (0.27-0.33 s), 8-12 f (0.13-0.2 s) stagger.
- Step version: each word holds the accent 16-20 f (0.27-0.33 s); the final word keeps it until one frame before the cut.
- An object tint resolves over 20-40 f (0.33-0.67 s).

## Sound for it

Typing gets one soft `typing_burst` (-18 dB) under the whole run, not a key per letter; a generated pill gets one `pop` (-14 dB) when it lands.

## Common mistakes

- The accent already means something else in the shot (a focus ring, a pressed button).
- Long paragraphs, where the coloured wake turns to noise.
- A multi-stop hue cycle or a text shadow on the wake.
- Avoid when: The accent already means something else in the shot (a focus ring or a pressed button), or long paragraphs where the wake becomes noise.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-accent-on-newest`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
