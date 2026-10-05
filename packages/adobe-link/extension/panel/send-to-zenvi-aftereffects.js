"use strict";

/**
 * The panel's "Send to Zenvi" button in After Effects. Not wired yet (W1b):
 * set `run` to an async function, e.g. render the active comp with
 * ae_render_for_zenvi and add it to the open Zenvi project with the desktop's
 * import_linked_media_tool.
 *
 * run(ctx) gets:
 *   ctx.callHostTool(name, args)    -> {receipt, images, isError} from this app's Zenvi Link server
 *   ctx.callDesktopTool(name, args) -> the same from the running Zenvi desktop app (throws when it is not running)
 *   ctx.desktop                     -> {running, pid, project}
 * and returns a short line for the panel ("Sent \"Promo\" to Zenvi").
 * While `run` is null the button stays disabled.
 */
module.exports = {
  label: "Send to Zenvi",
  run: null,
};
