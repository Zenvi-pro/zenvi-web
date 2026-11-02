import { describe, expect, it } from "vitest";
import { assistantEngineTools, getTool, unavailableAssistantTools } from "./registry.js";
import { CONTRACT_TOOL_NAMES } from "./schemas.gen.js";
import { fakeHost } from "./test-support/fake-host.js";

const COMFYUI = ["list_comfyui_templates_tool", "list_comfyui_jobs_tool", "create_media_with_comfyui_tool", "enhance_file_with_comfyui_tool", "cancel_comfyui_job_tool"];

describe("unavailableAssistantTools", () => {
  it("names the desktop-only tools a web editor's Assistant must not be offered", () => {
    const names = unavailableAssistantTools("editor");
    for (const name of [...COMFYUI, "prepare_recording_tool", "open_project_tool"]) expect(names).toContain(name);
    // What the web editor runs stays offered.
    for (const name of ["split_clip_tool", "import_stock_media_tool", "export_video_tool", "add_clip_to_timeline_tool"]) expect(names).not.toContain(name);
  });

  it("names the desktop tools newer than the contract, which the engine runs none of", () => {
    const names = unavailableAssistantTools("editor");
    // media-index-v2 tools the backend offers an editor that says so.
    for (const name of ["get_project_overview_tool", "search_footage_tool", "storyboard_tool", "view_frames_tool"]) expect(names).toContain(name);
    expect(names.filter((n) => !(CONTRACT_TOOL_NAMES as readonly string[]).includes(n)).every((n) => getTool(n) === undefined)).toBe(true);
  });

  it("adds the tools this host cannot run (a browser without video export)", () => {
    expect(unavailableAssistantTools("editor", fakeHost())).not.toContain("list_export_presets_tool");
    expect(unavailableAssistantTools("editor", fakeHost({ without: ["exporter"] }))).toContain("list_export_presets_tool");
  });
});

describe("assistantEngineTools", () => {
  it("names the engine tools a web editor's Assistant runs, the style and brief tools among them", () => {
    const names = assistantEngineTools("editor");
    for (const name of ["find_style_tool", "get_style_tool", "get_technique_tool", "save_brief_tool", "get_brief_tool", "auto_sound_design_tool"]) expect(names).toContain(name);
    // Not the desktop's contract tools (those are the backend's frontend tools), nor what the editor refuses.
    expect(names.some((n) => (CONTRACT_TOOL_NAMES as readonly string[]).includes(n))).toBe(false);
    expect(names).not.toContain("review_render_tool");
  });

  it("leaves out the tools this host cannot run (a browser without frame rendering)", () => {
    expect(assistantEngineTools("editor", fakeHost())).toContain("detect_subject_tool");
    expect(assistantEngineTools("editor", fakeHost({ without: ["frames"] }))).not.toContain("detect_subject_tool");
  });
});
