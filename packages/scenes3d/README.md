# @zenvi/scenes3d — Zenvi 3D

Polished 3D elements for edits, rendered by Blender (GPL, run as a separate
program; EEVEE) from scenes built entirely in code. No `.blend` files, no
downloaded assets: geometry, materials, the studio environment and the
animation are made by the bpy scripts at render time.

| Scene | What it is |
| --- | --- |
| `title_3d` | extruded chrome / glass / plastic / pearl / clay / gradient title; letters tumble in, or the word rises or spins; a light sweeps across |
| `device_mockup` | generic phone, tablet or laptop playing a bin video; camera orbit or push, hero spin-in, float |
| `floating_cards` | photos and videos as cards in depth with depth of field, staggered rise and drift |
| `icon_cube` | cube of glossy tiles (icons or colours), spins then bursts into cubelets |
| `cube_cut` | transition: clip A on a cube turns to clip B (first/last frames match the clips) |
| `glass_hero` | morphing glass blob, torus, linked rings or sphere cluster in gradient light |
| `particle_burst` | confetti, glowing sparks (bloom) or glass shards |
| `logo_extrude` | the user's SVG logo (or a word) extruded and bevelled: chrome, glass, plastic, matte, clay or its own fill colours; tumbles in or its pieces assemble, settles square to the camera |
| `model_showcase` | the user's `.glb/.gltf/.obj/.fbx/.stl/.ply` (or a generic music player / smart speaker, `zenvi3d/products.py`) centred, stood on the floor, framed; turntable, orbit or push-in; studio, dark or table-top staging; own materials, clay, chrome, x-ray or wireframe |
| `numerals_3d` | a huge extruded counter whose digits roll like an odometer (motion blur) through a list of values, with prefix and unit suffix |
| `terrain_glide` | full-frame backdrop: a low camera glide over grass (geometry-node tufts in the wind), sand dunes or snow, toward a low sun, with haze |
| `card_stack` | cards or paper (bin photos on them) tumble down onto a loose stack with real soft shadows, or land and fan out |

The params of each scene (zod) live in the engine:
`packages/engine/src/scenes3d/catalog.ts`. The tools are
`list_3d_scenes_tool`, `add_3d_scene_tool` and `rerender_3d_scene_tool`
(`packages/engine/src/tools/catalog/scenes3d.ts`); the CLI and local MCP
server offer them when Blender 4.2+ is installed (`ZENVI_BLENDER` sets its
path, `ZENVI_SCENES3D=0` turns them off, `zenvi doctor` checks).

Framing (`zenvi3d/camera.py` `compose`): the hero of `title_3d`,
`device_mockup`, `glass_hero`, `logo_extrude` (0.6), `model_showcase` (0.7,
its turning circle), `numerals_3d` (0.8) and `card_stack` spans `size`
(default ~0.65) of the safe width, on the optical centre, a little above the middle of the safe area. The
safe area is title-safe 90 % on wide frames; on 9:16 it keeps clear of the
Reels / TikTok UI (6 % sides, 12 % top, 20 % bottom).

## Layout

```
blender/worker.py          Blender entry: one job (--job) or a JSON-lines server on stdin
blender/zenvi3d/           shared bpy library: core (render settings, AgX, studio, backdrop, bloom),
                           materials, shapes (rounded bodies, panels, per-letter text), lights,
                           camera, motion (docs/TASTE.md easing as bezier handles), palette
blender/scenes/<id>.py     one scene each: build(job)
src/worker.ts              persistent Blender process (warm shaders), cancel, crash restart, idle exit
src/renderer.ts            fingerprint → cache → render PNG RGBA → ffmpeg ProRes 4444 / H.264
scripts/showcase.ts        every scene in 9:16 and 16:9 on dark and light + contact sheet + timings
```

Files on this computer (`logo_extrude` `svg`, `model_showcase` `model`) are
params the engine names by slot (`scene3dFiles`); the renderer resolves them
like project media, refuses missing ones, and fingerprints them by path,
size and mtime. A model Blender cannot import (an ASCII FBX, a broken glTF)
fails the render with `Blender could not import <name>: <reason>`.

Floors (`model_showcase`, `card_stack`) are shadow catchers
(`shapes.shadow_catcher`): a white diffuse floor seen through Shader to RGB,
divided by what an open floor receives (measured by a 4x4 probe render,
`calibrate_catcher`), is drawn as alpha, so real soft shadows land on any
backdrop or on footage. Light linking keeps the area lights off the floor.

`scripts/make-models.py` builds the showcase's demo models (a jet engine
glTF, a monkey OBJ) from Blender primitives; nothing is downloaded.

Transparent scenes encode as ProRes 4444 (alpha survives libopenshot; VP9
WebM alpha does not). Opaque scenes render RGBA too and are laid over a
backdrop PNG the scene writes, so backdrop colours come out exact under AgX.

Renders are cached in Zenvi's cache folder (`scenes3d/<sha256>.mov|mp4`) by a
fingerprint of the scene, params, media identity, size, fps, frames,
quality, font and a hash of every script, so editing a scene re-renders.
