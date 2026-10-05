"use strict";

/**
 * The panel's "Send to Zenvi" button in Premiere Pro: export the active
 * sequence as FCP XML with premiere_export_xml (into the temp folder), then
 * have the running Zenvi desktop app import it on new tracks with its
 * import_timeline_xml_tool (SPEC 3.5, the Premiere -> Zenvi handoff).
 *
 * run(ctx) gets (panel.js):
 *   ctx.callHostTool(name, args)    -> {receipt, images, isError} from this app's Zenvi Link server
 *   ctx.callDesktopTool(name, args) -> the same from the running Zenvi desktop app (rejects when it is not running)
 *   ctx.desktop                     -> {running, pid, project} (gui_mcp.json with a live pid)
 *   ctx.progress(text)              -> optional: a status line while it works
 * and returns a short line for the panel. Failures reject with a message the
 * panel shows after "Error: ".
 */

/** The message of a failed call: the receipt's summary or the tool's text, without a leading "Error: ". */
function failure(result, fallback) {
  const receipt = result && result.receipt;
  const text = (receipt && receipt.summary) || (result && result.text) || fallback;
  return String(text).replace(/^Error:\s*/, "");
}

function progress(ctx, text) {
  if (ctx && typeof ctx.progress === "function") ctx.progress(text);
}

async function run(ctx) {
  if (!ctx.desktop || !ctx.desktop.running) {
    throw new Error("The Zenvi desktop app is not running. Open Zenvi with a project, then send again.");
  }
  progress(ctx, "Exporting the sequence as FCP XML\u2026");
  const exported = await ctx.callHostTool("premiere_export_xml", {});
  if (!exported || exported.isError || !exported.receipt || !exported.receipt.data || typeof exported.receipt.data.path !== "string") {
    throw new Error(failure(exported, "Premiere did not export the sequence."));
  }
  const xml = exported.receipt.data.path;
  const name = exported.receipt.data.name || "the sequence";
  progress(ctx, "Importing \"" + name + "\" into Zenvi\u2026");
  const imported = await ctx.callDesktopTool("import_timeline_xml_tool", { path: xml, placement: "new_tracks" });
  if (!imported || imported.isError) {
    throw new Error("Zenvi could not import \"" + name + "\": " + failure(imported, "no answer from the desktop app") + " (XML: " + xml + ")");
  }
  const summary = imported.receipt && imported.receipt.summary ? String(imported.receipt.summary) : "";
  return "Sent \"" + name + "\" to Zenvi on new tracks" + (summary ? ": " + summary : ".");
}

module.exports = {
  label: "Send to Zenvi",
  run: run,
};
