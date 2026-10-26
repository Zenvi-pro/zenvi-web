# Zenvi taste guide (motion design + editing)

Source of truth for the defaults baked into Zenvi Link tools (After Effects,
Premiere Pro), the Zenvi MCP prompts/resources, and the Claude Code skills.
Every number here is a *default* an agent may override with a reason. Tools
must use these defaults when an argument is omitted, so a lazy call still looks
professional.

## 0. Principles

1. **Intent before effect.** Every move must answer "what should the viewer
   notice next?" If an animation does not direct attention, cut it.
2. **Less, but consistent.** One easing family, one type family (two at most),
   one accent colour per piece. Repetition reads as design; variety reads as
   accident.
3. **Motion has weight.** Nothing starts or stops instantly (no linear easing on
   anything that moves on screen). Things enter fast and settle slowly.
4. **Respect the frame.** Keep text inside title-safe, keep faces and eyes in
   the upper third, never let graphics cover the subject's mouth.
5. **Look before you say done.** After any visual change, capture a frame
   (`ae_capture_frame`, `premiere_capture_frame`, `preview_frame`) at the
   moments that matter (entrance end, hold, exit start) and critique it against
   this guide. Fix, then capture again.

## 1. Timing

| Use | Duration | Notes |
| --- | --- | --- |
| UI-like micro motion (pop, nudge) | 0.20–0.35 s | 6–10 frames at 30 fps |
| Text / element entrance | 0.50–0.80 s | default **0.6 s** |
| Text / element exit | 0.35–0.50 s | default **0.4 s** (exits are faster than entrances) |
| Big moves (full-frame push, logo reveal) | 0.8–1.2 s | default **1.0 s** |
| Stagger between words / lines / items | 0.04–0.08 s | default **0.06 s** per word, **0.12 s** per line |
| Minimum on-screen hold for text | 1.5 s + 0.3 s per word | never shorter than reading time |
| Lower third total | 4–6 s | in 0.6 s, hold, out 0.4 s |
| Title card | 2.5–4 s | |
| Cross dissolve | 0.5–1.0 s | default **0.5 s** for cuts within a scene, **1.0 s** for time/place change |
| Dip to black/white | 0.6–1.2 s | use for chapter breaks only |
| Audio fade in / out | 0.25 s / 0.5–1.5 s | music end fades: **1.5 s** |
| J/L cut audio lead | 0.25–0.75 s | lead the cut with sound |

Prefer frame-exact values: snap every time to the composition/sequence frame
grid.

## 2. Easing

Named easings every tool understands (cubic-bezier control points):

| Name | cubic-bezier | Use |
| --- | --- | --- |
| `smooth` (default) | (0.33, 0.00, 0.20, 1.00) | general-purpose moves |
| `out` / `entrance` | (0.16, 1.00, 0.30, 1.00) | things arriving (expo-out feel) |
| `in` / `exit` | (0.70, 0.00, 0.84, 0.00) | things leaving |
| `in-out` | (0.65, 0.00, 0.35, 1.00) | moves between two resting states |
| `snap` | (0.20, 0.00, 0.00, 1.00) | punchy pops, kinetic type |
| `linear` | (0, 0, 1, 1) | ONLY opacity crossfades, rotations that loop, tickers |
| `hold` | — | step changes |

- Overshoot (`back-out`) only for playful brands; max overshoot **6%** of the
  distance, settle within 0.25 s. Implement as an extra keyframe, not as an
  expression, so it is editable.
- After Effects mapping: for a segment with value change dv over dt, and
  bezier (x1, y1, x2, y2):
  outgoing ease of the first key: influence = x1·100 %, speed = (y1/x1)·dv/dt;
  incoming ease of the second key: influence = (1−x2)·100 %,
  speed = ((1−y2)/(1−x2))·dv/dt (speed 0 when x1 or 1−x2 is 0). Spatial
  properties use the path length as dv. Clamp influence to [0.1, 100].
- Premiere Pro keyframes: use Bezier interpolation with ease-in/ease-out on
  the resting keyframes (`setInterpolationTypeAtKey` with
  `KF_Interp_Mode_Bezier`/ease variants); never leave Linear on Motion.

## 3. Space and layout

- **Safe areas:** action-safe 5 % inset, title-safe 10 % inset (of each
  dimension). Vertical 9:16 social: keep text out of the bottom 20 % (UI) and
  top 12 % (status/handle) — i.e. title-safe for 1080×1920 is
  x ∈ [108, 972], y ∈ [230, 1536].
- **Grid:** 12-column grid with a margin equal to the title-safe inset; align
  text left edges to a column, not "roughly centered".
- **Lower third:** left-aligned at title-safe x; baseline of the name at
  ~80 % of the frame height (landscape), ~70 % (vertical). Name / title
  stacked, gap = 0.25 × name size.
- **Movement distance:** entrances travel 3–6 % of the frame width (not from
  off-screen) unless it is a full push. Default slide distance: **4 %**.
- **Scale moves:** 92 %→100 % on entrance, 100 %→104 % slow push on holds
  (Ken Burns 3–6 % over the shot length, `in-out`).

## 4. Typography

- Default families (in order of availability): Inter, SF Pro Display,
  Helvetica Neue, Arial. Headlines: weight 700–800; supporting text: 400–500.
- Type scale at 1080p (landscape): headline 96 px, title 72 px, subtitle
  44 px, lower-third name 54 px / role 34 px, caption 42 px. Scale linearly
  with frame height (vertical 1920: multiply by 1.0 using the *width* 1080 as
  the base, i.e. same pixel sizes).
- Tracking: headlines −1 % to −2 %; all-caps labels +6 % to +10 %.
- Leading: 1.1× for headlines, 1.3× for body.
- Max line length: 32 characters for on-screen text; break lines on phrase
  boundaries, never leave a single orphan word.
- Contrast: text over video gets a 35–55 % black scrim, a soft drop shadow
  (distance 0, softness 12–20 px, opacity 40 %) or a solid bar — never bare
  white text over busy footage. Check WCAG-like contrast ≥ 4.5:1 against the
  average of the area behind it.

## 5. Colour

- One accent colour + neutrals. Default palette when the brand gives none:
  ink #0B0B0F, paper #F7F7F5, accent #FF5A36, secondary #2F6BFF.
- Looks (Lumetri-based in Adobe, Zenvi color tools in Zenvi): `clean` (+5
  contrast, +5 vibrance), `warm-film` (temp +8, tint +2, fade 8, sat −6),
  `teal-orange` (shadows → teal, highlights → orange, sat +6), `moody`
  (exposure −0.3, contrast +12, sat −15, vignette −0.8), `bw-contrast`
  (sat 0, contrast +25). Apply at ≤ 60 % strength by default; skin must stay
  natural.

## 6. Editing rhythm

- Cut on action or on the beat; with music, cut on downbeats (bars), not on
  every beat.
- Average shot length: talking head 4–8 s; b-roll 1.5–3 s; social hooks
  0.8–1.5 s for the first 3 s.
- First frame matters: no fade-in from black on social; open on motion or a
  face.
- End on a deliberate hold (0.5–1.0 s) before the final fade.
- Audio: dialogue −12 to −6 dBFS peaks (≈ −16 LUFS integrated for social,
  −23 LUFS broadcast); music under dialogue −18 to −24 dB below; duck 6–10 dB
  with 0.3 s attack / 0.6 s release.
- Sound design (`auto_sound_design_tool`, `add_sfx_tool`): in the reference
  reels a cut lands on an audio transient 50–100 % of the time but on the
  music's beat only 20–40 % — the effect makes the cut. A whoosh peaks on the
  cut and is as long as the move; an impact's transient lands on hard cuts,
  downbeats and flash frames, at most about once a bar; clicks and pops go on
  UI moments and title entrances; a riser builds into the drop and an impact
  lands on it. Never two transients within 80 ms; vary seed and pitch so
  repeats do not machine-gun. Effects peak around −8…−14 dBFS under the
  music and further under dialogue; no clicks over speech.

## 7. Review checklist (agents run this before reporting success)

1. Capture frames at: first frame, every entrance end, mid-hold, last frame.
2. Is all text inside title-safe and readable at phone size?
3. Is anything moving with linear easing or ending abruptly?
4. Are durations within the tables above? Are holds long enough to read?
5. Does every element align to the grid/edges of its siblings?
6. Is there exactly one focal point per moment?
7. Audio: no clipping, music ducked under speech, fades at the end.
Report what you checked and any deliberate exceptions.
