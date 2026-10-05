"use strict";

/**
 * The panel's "Send to Zenvi" button in Premiere Pro. Not wired yet (W1c): set
 * `run` to an async function, e.g. export the active sequence with
 * premiere_export_xml and bring it into Zenvi with the desktop's
 * import_timeline_xml_tool.
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
