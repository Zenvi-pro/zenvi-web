---
description: Make or change a video with Zenvi (import footage, build the cut, check frames, render)
argument-hint: "<what to make, e.g. a 30 s highlight reel from ./footage with music.mp3>"
---

Use the Zenvi MCP tools and the zenvi-video-editing skill to do this: $ARGUMENTS

1. Open (or create) a `.zvn` project with `open_project_file`; if the request names no file, create one named after the task in the working folder.
2. Import the media it mentions (`import_files_tool`), check durations with `list_files_tool`, then build the edit on the timeline.
3. Check the result with `preview_frame` at the important moments (start, each transition, titles, the end) and fix anything that looks wrong.
4. Render with `render_video` and report the output path, length and size.
5. Offer to open it in the Zenvi app (`launch_editor`) or share a web link (`push_to_cloud`).
