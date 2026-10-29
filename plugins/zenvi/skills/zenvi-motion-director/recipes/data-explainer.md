---
id: data-explainer
kind: style
summary: A voice explains numbers and places - a map push-in, markers on hits, a pictogram chart, a bar race and a date clock
categories: [video-essay-explainer, news-short-vertical-explainer, documentary-true-story]
tools: [add_motion_block_tool, generate_tts_and_add_to_timeline_tool, auto_sound_design_tool]
pace: medium
mood: [curious, serious]
aspect: ["16:9", "9:16"]
pairs_with: []
avoid_with: []
---
# Data / map explainer

A voice explains numbers and places: the camera pushes from the whole globe
into the region, markers pop 0.2 s apart while it is still moving, a unit-icon
chart regroups to make the point and dissolves to footage with a few icons
held, a race shows who leads over the years, and a stepped date clock keeps
time. Every graphic lands on a hit; whooshes on camera moves and dissolves.

## Structure (24 s)

| t (s) | what |
| --- | --- |
| 0-6 | `geo_map`: world → place, highlights fill, markers pop, routes draw |
| 0-6 (over it) | `data_clock` band or ghost year when the story moves through time |
| 6-14 | `pictogram_morph`: grid → groups → bars, then `hold` over the footage the story cuts to |
| 14-24 | `bar_race` (who leads over time) or `chart_build` (one moment's numbers) |

## Tools

1. Map: `add_motion_block_tool` `{"block": "geo_map", "params": {"focus":
   "Western Africa", "highlight": ["Nigeria", "Ghana"], "markers": ["Lagos",
   "Accra"], "route": "path", "title": "Two capitals, one corridor"}}`.
   Places are countries, continents, Natural Earth subregions ("Southern
   Asia"), cities ("Paris, France") or "lat, lon"; an unknown name is refused
   with a suggestion. `projection: "flat"` for a newsroom map, `"globe"` for
   the push-in. Per-country numbers: `values: ["France=31", "Spain=24"]`,
   `legend`, `suffix`.
2. Time: `add_motion_block_tool` `{"block": "data_clock", "params":
   {"style": "band", "start": "2006-01-20", "end": "2006-02-05", "step":
   "day", "legends": ["CO₂ ppm=377..395@thermal"]}}` on the track above a
   map or a time-lapse; `style: "ghost"` for a huge year, `reverse: true`
   over a reversed clip.
3. Unit chart: `{"block": "pictogram_morph", "params": {"groups":
   ["Lost=60", "Returned=340"], "unit": 2, "icon": "person", "layouts":
   ["grid", "bars", "hold"], "captions": ["Of 400 who sailed", "", "Three
   wrote home"], "keep": 3}}` on the track above the footage the hold
   dissolves to (the block has alpha; the backdrop fades on `hold`).
4. Race: `{"block": "bar_race", "params": {"series": ["Kite=1, 8, 27, 52",
   "Atlas=12, 17, 19, 22"], "periods": ["2018", "2020", "2022", "2024"],
   "suffix": "M", "top": 6}}`, 8-12 s long so each period gets about 2 s.
5. Sound: `auto_sound_design_tool` reads each block's picture events
   (marker pops, overtakes, the clock's ticks, the hold's whoosh); duck the
   music under the voice.

## Finish (every run, in this order; never skip it)

1. Sound on every cut and every graphic event (step 5).
2. `master_audio_tool` `{"preset": "social", "genre": "video_essay", "iterate": true}`.
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass on every `PROBLEM` line, render and review again.

## Checks

Numbers come from the brief or a cited source, never invented; the place the
voice names is on screen when it is said; one accent colour per graphic.

## Pitfalls

- Every country highlighted: the accent stops meaning anything; highlight
  the two or three the line is about.
- `geo_map` with only `focus` (or only `markers`): `highlight` and `markers`
  default to a Western Europe demo that is filled and pinned on your map too.
  Always pass both, `[]` for none.
- A race with 15 bars on a vertical frame: keep `top` at 5-6.
- Map markers spoken after they popped: put the block so the pops land on
  the words.
