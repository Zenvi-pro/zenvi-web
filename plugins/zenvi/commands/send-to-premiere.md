---
description: Send the current Zenvi project to Premiere Pro as a new sequence (through Zenvi Link)
argument-hint: "[what to do in Premiere afterwards]"
---

Send the current Zenvi project to Premiere Pro, using the Zenvi MCP tools and the premiere-pro skill. Then: $ARGUMENTS

1. Call `list_hosts`. If Premiere Pro is not connected, say so, quote the entry's `how_to_connect`, and offer `/zenvi:adobe-setup`. Offer `export_to_premiere_tool` instead (FCP7 XML for File > Import) and stop unless they want that.
2. The project must be saved: if the session has no project file, ask which `.zvn` to use and call `open_project_file`.
3. Call `send_to_premiere_tool`. The Zenvi desktop app opens on the project if needed, writes FCP XML and Premiere imports it as a new sequence.
4. Verify: `premiere_get_state` and `premiere_get_sequence` for the new sequence (tracks, clip count, duration). Capture two or three moments with `premiere_capture_frame` and compare them with `preview_frame` at the same times in Zenvi.
5. Report the sequence name and length, every warning from the export, and anything that looks different (titles arrive as PNG stills). Remember that Premiere has no undo grouping: each change there is its own undo step. If the user asked for more work in Premiere, continue with the `premiere_*` tools and the taste guide (`zenvi://taste`).
