import { createProject, findProfile } from "@zenvi/engine";
import { runTool } from "@zenvi/engine/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryMediaStore } from "@/lib/storage/media";
import { MemoryProjectRepository, setProjectRepository } from "@/lib/storage/projects";
import { EditorSession } from "../session/EditorSession";
import { MediaLibrary } from "../session/media";
import { createUiStore } from "../session/uiStore";
import { editorLayout, editorPreferences, withLayout, withPreference } from "./editorSettings";
import { createToolHost } from "./host";

function session(): EditorSession {
  const project = createProject({ profile: findProfile("HD 1080p 30 fps")! });
  const meta = { id: "local1", name: "Test", createdAt: 0, updatedAt: 0, width: 1920, height: 1080, fps: { num: 30, den: 1 }, duration: 0, clipCount: 0, fileCount: 0 };
  const media = new MediaLibrary({ store: async () => new MemoryMediaStore(), probe: vi.fn() });
  return new EditorSession({ meta, project, repository: new MemoryProjectRepository(), media, cloud: () => null });
}

afterEach(() => setProjectRepository(null));

describe("the editor's panels", () => {
  it("reports one library tab and one inspector tab open, the preview and the timeline always", () => {
    const ui = createUiStore({ leftTab: "files", rightTab: "properties" }).getState();
    const layout = editorLayout({ ...ui, panels: { ...ui.panels, leftCollapsed: false, rightCollapsed: false } }, false);
    expect(layout.view).toBe("simple");
    expect(layout.panels.filter((p) => p.open).map((p) => p.name)).toEqual(["Project Files", "Properties", "Video Preview", "Timeline"]);
    expect(layout.panels.find((p) => p.name === "Timeline")).toMatchObject({ closable: false });
  });

  it("opens a tab on its side and closes a side when its open tab is hidden", () => {
    const ui = createUiStore({ leftTab: "files", rightTab: "properties" }).getState();
    const shown = withLayout(ui, { show: ["Effects", "Assistant"] });
    expect([shown.leftTab, shown.rightTab, shown.panels.leftCollapsed, shown.panels.rightCollapsed]).toEqual(["effects", "assistant", false, false]);
    const hidden = withLayout({ ...ui, ...shown }, { hide: ["Effects", "Properties"] });
    expect([hidden.panels.leftCollapsed, hidden.panels.rightCollapsed]).toEqual([true, false]);
    const simple = withLayout({ ...ui, ...hidden }, { view: "simple" });
    expect([simple.leftTab, simple.rightTab, simple.panels.leftCollapsed, simple.panels.rightCollapsed]).toEqual(["files", "properties", false, false]);
  });

  it("lists snapping as a setting and the rest read-only", () => {
    const prefs = editorPreferences(createUiStore({ snapping: false }).getState(), "https://api.zenvi.pro");
    const snapping = prefs.find((p) => p.key === "snapping")!;
    expect(snapping).toMatchObject({ value: false, default: true, tab: "Timeline" });
    expect(snapping).not.toHaveProperty("readOnly");
    expect(prefs.find((p) => p.key === "actionAddMarker")).toMatchObject({ title: "Add Marker", tab: "Keyboard", value: "M" });
    expect(prefs.filter((p) => p.key !== "snapping").every((p) => p.readOnly)).toBe(true);
    expect(withPreference("snapping", true)).toEqual({ snapping: true });
    expect(() => withPreference("history-limit", 10)).toThrow();
  });
});

describe("the layout, preference and cache tools in the web editor", () => {
  it("changes panels and snapping, clears the playback cache, and lists this browser's projects", async () => {
    const repository = new MemoryProjectRepository();
    setProjectRepository(repository);
    const s = session();
    await repository.save({ ...s.meta.getState(), id: "older", name: "Older", updatedAt: 1000 }, createProject());
    await repository.save({ ...s.meta.getState(), id: "newer", name: "Newer", updatedAt: 2000 }, createProject());
    const host = createToolHost(s, async () => []);
    const ctx = { doc: s.doc, host };

    const layout = await runTool(ctx, "set_editor_layout_tool", { show_panels: ["effects"], hide_panels: ["properties"] });
    expect(layout.ok).toBe(true);
    expect([s.ui.getState().leftTab, s.ui.getState().panels.rightCollapsed]).toEqual(["effects", true]);
    expect((await runTool(ctx, "get_editor_layout_tool", {})).data?.data).toMatchObject({ open_panels: ["Effects", "Timeline", "Video Preview"] });

    expect((await runTool(ctx, "set_preference_tool", { key: "Snapping", value: "off" })).ok).toBe(true);
    expect(s.ui.getState().snapping).toBe(false);
    const locked = await runTool(ctx, "set_preference_tool", { key: "history-limit", value: "10" });
    expect(locked.data?.summary).toMatch(/^Error: 'history-limit' is protected: the web editor keeps the last 50 undo steps/);

    const clear = vi.spyOn(s.previews, "clear");
    expect((await runTool(ctx, "reset_caches_and_history_tool", { target: "playback_cache" })).data?.summary).toBe("Cleared the playback cache; preview frames will re-render.");
    expect(clear).toHaveBeenCalledOnce();

    const recent = await runTool(ctx, "list_recent_projects_tool", {});
    expect(recent.data?.summary).toBe("2 recent project(s); most recent: Newer.");
    expect(recent.data?.data).toMatchObject({ current_path: "local1", projects: [{ index: 1, path: "newer" }, { index: 2, path: "older" }] });
    expect(s.doc.undoLabels).toEqual([]);
    await s.dispose();
  });
});
