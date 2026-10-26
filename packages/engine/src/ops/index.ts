/**
 * Editing operations: the one implementation of every edit the web editor,
 * the CLI, the MCP servers and the Assistant bridge perform.
 *
 * Contract:
 * - Ops are synchronous and take a `Transaction` (history/document.ts). Call
 *   them inside one transaction per user intent:
 *   `doc.transaction("Split clip", (tx) => splitClip(tx, id, 12.5))`.
 *   (`storeExportOverrides` is the exception: export overrides are not an undo
 *   step on the desktop, so it takes the document and writes untracked.)
 * - Ops validate every input first and throw `OpError` (`code`, `message`)
 *   before recording anything, so a failed op leaves history untouched.
 * - An op whose inputs are valid but change nothing records nothing.
 * - Ops return the objects they created or changed, as they are in the
 *   project after the op, so callers can build receipts without re-reading.
 * - Times are seconds; keyframe frames are 1-based at the project frame rate.
 */

export * from "./errors.js";
export * from "./types.js";
export * from "./files.js";
export * from "./clips.js";
export * from "./values.js";
export * from "./keyframes.js";
export * from "./arrange.js";
export * from "./look.js";
export * from "./match-cut.js";
export * from "./effects.js";
export * from "./transitions.js";
export * from "./tracks.js";
export * from "./markers.js";
export * from "./project.js";
export * from "./titles.js";
export * from "./overlays.js";
export * from "./clipboard.js";
export * from "./presets.js";
export * from "./clip-props.js";
export * from "./sequence.js";
export * from "./add-to-timeline.js";
export { timeCurveIsReversed } from "./retime.js";
export * from "./project-files.js";
export * from "./waveforms.js";
export * from "./media-collect.js";
