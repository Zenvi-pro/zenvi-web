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

The params of each scene (zod) live in the engine:
`packages/engine/src/scenes3d/catalog.ts`. The tools are
`list_3d_scenes_tool`, `add_3d_scene_tool` and `rerender_3d_scene_tool`
(`packages/engine/src/tools/catalog/scenes3d.ts`); the CLI and local MCP
server offer them when Blender 4.2+ is installed (`ZENVI_BLENDER` sets its
path, `ZENVI_SCENES3D=0` turns them off, `zenvi doctor` checks).

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

Transparent scenes encode as ProRes 4444 (alpha survives libopenshot; VP9
WebM alpha does not). Opaque scenes render RGBA too and are laid over a
backdrop PNG the scene writes, so backdrop colours come out exact under AgX.

Renders are cached in Zenvi's cache folder (`scenes3d/<sha256>.mov|mp4`) by a
fingerprint of the scene, params, media identity, size, fps, frames,
quality, font and a hash of every script, so editing a scene re-renders.
