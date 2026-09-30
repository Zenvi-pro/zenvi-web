---
description: Upload the current project to Zenvi Cloud and get a web editor link
argument-hint: "[cloud project name]"
---

Call `push_to_cloud` for the current Zenvi project (name: `$1` if given). If it says the user is not signed in, tell them to run `zenvi login` in a terminal (`node ${CLAUDE_PLUGIN_ROOT}/dist/zenvi.mjs login`), then try again. Give the user the web editor link from the receipt.
