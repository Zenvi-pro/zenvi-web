// @zenvi/engine/tools — the one tool catalog every Zenvi surface exposes.
export type * from "./types.js";
export * from "./receipt.js";
export * from "./wire.js";
export * from "./json-schema.js";
export { HIDDEN_PARAMS, normalizeArgs } from "./coerce.js";
export {
  CONTRACT_REF,
  CONTRACT_TOOL_NAMES,
  contractInputs,
  contractMeta,
  type ContractInput,
  type ContractToolMeta,
  type ContractToolName,
} from "./schemas.gen.js";
export {
  buildEditorSnapshot,
  timelineStateText,
  timelineStateData,
  type EditorSnapshotOptions,
  type TimelineStateData,
} from "./reports.js";
export {
  capabilityName,
  missingCapabilities,
  resultFor,
  unavailable,
  unavailableMessage,
  type CatalogTool,
  type ToolCall,
  type ToolOutcome,
} from "./define.js";
export {
  allTools,
  getTool,
  listTools,
  runTool,
  unknownToolMessage,
  type ListToolsOptions,
  type RunToolOptions,
} from "./registry.js";
export {
  SURFACE_PROFILES,
  TOOL_NEEDS,
  toolAvailability,
  availabilityMatrix,
  type Availability,
  type AvailabilitySurface,
  type HostMethod,
  type SurfaceProfile,
  type ToolAvailability,
  type ToolNeeds,
} from "./availability.js";
export { RECEIPT_OUTPUT_SCHEMA } from "./output-schema.js";
