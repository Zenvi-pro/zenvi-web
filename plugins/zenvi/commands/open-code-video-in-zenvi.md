---
description: Open a Remotion or HyperFrames project in Zenvi as linked clips (editable as code)
argument-hint: "<project folder> [composition ids] [where in the timeline]"
---

Bring this code video project into the current Zenvi project, using the code-video-handoff skill: $ARGUMENTS

1. Find the folder (default: the working folder). Remotion: a `package.json` that depends on `remotion`. HyperFrames: an `index.html` composition (and usually `hyperframes.json`). If it is neither, say what you found and stop.
2. Make sure the Zenvi session has a saved project (`open_project_file`; create one named after the folder if the user has none).
3. Remotion: `list_remotion_compositions_tool {project_dir}`, show the compositions (id, size, fps, duration, props), ask which ones when there are several and the user did not say, then `import_remotion_project_tool` with them (codec `auto`). A project Zenvi exported comes back as native clips.
   HyperFrames: `import_hyperframes_project_tool {project_dir}` (mode `auto`).
4. Look at the result with `preview_frame` at the start and the middle of each new clip, and `get_linked_clip_tool` for one of them (state should be `fresh`).
5. Report what landed where (clip ids, tracks, times) and how to keep working: change props with `update_linked_clip_tool`, edit the code then `rerender_linked_clip_tool`, `open_linked_source_tool` for the code or the studio, `launch_editor` to see it in the Zenvi app.
