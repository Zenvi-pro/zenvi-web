---
description: Render the current Zenvi project to a video file
argument-hint: "[output file, e.g. out.mp4] [quality low|medium|high]"
---

Render the current Zenvi project with `render_video`. Output: `$1` if given (the format follows the extension), otherwise the default next to the project. Quality: `$2` if given, otherwise high. Before rendering, check two or three frames with `preview_frame`. Report the output path, duration and file size, and any warnings.
