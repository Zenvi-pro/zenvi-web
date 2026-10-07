"use strict";

/**
 * The panel's "Send to Zenvi" button in After Effects (AE -> Zenvi, SPEC 1):
 * render the active comp with ae_render_for_zenvi, then add the file to the
 * open Zenvi project as a linked clip with the desktop's
 * import_linked_media_tool, passing the SPEC 3.6 link the render returned
 * (kind "aftereffects", the comp's name and id, the .aep), so Zenvi can
 * re-render it later.
 *
 * run(ctx) gets (panel.js):
 *   ctx.callHostTool(name, args, timeoutMs)    -> {receipt, images, isError} from this app's server
 *   ctx.callDesktopTool(name, args, timeoutMs) -> the same from the Zenvi desktop app (throws when it is not running)
 *   ctx.desktop                                -> {running, pid, project}
 * and returns the line the panel shows. A thrown Error's message is shown
 * after "Error: ".
 */

// ae_render_for_zenvi's catalog timeout (30 min) plus slack for the server's queue.
const RENDER_TIMEOUT_MS = 31 * 60 * 1000;
// Importing copies or links the render into the project's assets.
const IMPORT_TIMEOUT_MS = 5 * 60 * 1000;

/** The problem a tool result reports, or null when it worked. */
function problem(result, who) {
  const receipt = result && result.receipt;
  if (!receipt) return who + " did not answer";
  if (result.isError || receipt.status === "error" || receipt.status === "refused") {
    return String(receipt.summary || who + " failed").replace(/^Error:\s*/, "");
  }
  return null;
}

async function run(ctx) {
  if (!ctx.desktop || !ctx.desktop.running) {
    throw new Error("Zenvi is not running. Open the Zenvi desktop app with your project, then send again.");
  }
  const rendered = await ctx.callHostTool("ae_render_for_zenvi", {}, RENDER_TIMEOUT_MS);
  const renderProblem = problem(rendered, "After Effects");
  if (renderProblem) throw new Error(renderProblem);
  const data = rendered.receipt.data || {};
  if (!data.path || !data.link) throw new Error("After Effects did not report the rendered file");

  const imported = await ctx.callDesktopTool("import_linked_media_tool", { path: data.path, link: data.link, name: data.comp_name }, IMPORT_TIMEOUT_MS);
  const importProblem = problem(imported, "Zenvi");
  if (importProblem) throw new Error("Zenvi could not add the render (" + data.path + "): " + importProblem);

  const seconds = Math.round(Number(data.duration) * 100) / 100;
  return 'Sent "' + data.comp_name + '" to Zenvi (' + seconds + " s, " + data.codec + ")" + (data.project ? "" : "; save the .aep so Zenvi can re-render it");
}

module.exports = {
  label: "Send to Zenvi",
  run: run,
};
