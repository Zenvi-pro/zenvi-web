/**
 * Timeline math and queries: frame-rate conversion, clip frame windows
 * (exactly as libopenshot `Timeline::GetFrame` finds intersecting clips),
 * stacking order, gaps, snapping, project duration.
 */
export * from "./time.js";
export * from "./windows.js";
export * from "./queries.js";
export * from "./duration.js";
export * from "./snap.js";
