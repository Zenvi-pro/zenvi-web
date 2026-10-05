---
description: Send the current Zenvi project to After Effects as a comp (through Zenvi Link)
argument-hint: "[what to do in After Effects afterwards]"
---

Send the current Zenvi project to After Effects, using the Zenvi MCP tools and the after-effects skill. Then: $ARGUMENTS

1. Call `list_hosts`. If After Effects is not connected, say so, quote the entry's `how_to_connect`, and offer `/zenvi:adobe-setup`. Offer `export_to_after_effects_tool` instead (it writes a `.jsx` the user can run with File > Scripts > Run Script File) and stop unless they want that.
2. The project must be saved: if the session has no project file, ask which `.zvn` to use and call `open_project_file`.
3. Call `send_to_after_effects_tool`. The Zenvi desktop app opens on the project if needed and rebuilds the timeline as one comp in After Effects (one After Effects undo step).
4. Verify: `ae_get_state`, then `ae_get_comp` for the new comp. Capture two or three moments with `ae_capture_frame` (a title, a transition, the end) and compare them with `preview_frame` at the same times in Zenvi.
5. Report the comp name, its size, fps and duration, every warning from the export (effects without an After Effects equivalent), and anything that looks different. If the user asked for more work in After Effects, continue with the `ae_*` tools and the taste guide (`zenvi://taste`), looking at frames before you say it is done.
