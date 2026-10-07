import { describe, expect, it, vi } from "vitest";
import { comboFromEvent, parseBindings, parseCombo, type KeyLike } from "./combo";
import { createDispatcher, isEditableTarget, type KeyEventLike, type ShortcutCommand } from "./dispatcher";
import { formatShortcut, shortcutLabel } from "./format";
import { buildKeymap, DESKTOP_KEYMAP, invertKeymap, primaryShortcut } from "./keymap";

function key(partial: Partial<KeyLike> & { key: string; code: string }): KeyLike {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...partial };
}

function event(partial: Partial<KeyEventLike> & { key: string; code: string }): KeyEventLike {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    target: null,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...partial,
  };
}

describe("parseCombo", () => {
  it("orders modifiers canonically", () => {
    expect(parseCombo("Shift+Ctrl+Left")).toBe("Ctrl+Shift+Left");
    expect(parseCombo("Alt+Shift+K")).toBe("Alt+Shift+K");
  });

  it("normalizes key names like Qt", () => {
    expect(parseCombo("Ctrl+Shift+ESC")).toBe("Ctrl+Shift+Esc");
    expect(parseCombo("Ctrl+Page Up")).toBe("Ctrl+Page Up");
    expect(parseCombo("space")).toBe("Space");
    expect(parseCombo("f11")).toBe("F11");
    expect(parseCombo("m")).toBe("M");
  });

  it("handles punctuation and a literal plus", () => {
    expect(parseCombo("=")).toBe("=");
    expect(parseCombo("Ctrl+=")).toBe("Ctrl+=");
    expect(parseCombo("Shift+\\")).toBe("Shift+\\");
    expect(parseCombo("Ctrl+Shift+/")).toBe("Ctrl+Shift+/");
    expect(parseCombo("Ctrl++")).toBe("Ctrl++");
  });

  it("rejects unknown modifiers and empty input", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("Hyper+K")).toBeNull();
  });
});

describe("parseBindings", () => {
  it("splits desktop binding lists with and without spaces", () => {
    expect(parseBindings("C | B | R")).toEqual(["C", "B", "R"]);
    expect(parseBindings("Shift+C|Alt+Up")).toEqual(["Shift+C", "Alt+Up"]);
    expect(parseBindings("Space | Up | Down | K")).toEqual(["Space", "Up", "Down", "K"]);
  });
});

describe("comboFromEvent", () => {
  it("maps Command to Ctrl on macOS", () => {
    expect(comboFromEvent(key({ key: "z", code: "KeyZ", metaKey: true }), true)).toBe("Ctrl+Z");
    expect(comboFromEvent(key({ key: "z", code: "KeyZ", metaKey: true, shiftKey: true }), true)).toBe("Ctrl+Shift+Z");
    expect(comboFromEvent(key({ key: "z", code: "KeyZ", ctrlKey: true }), true)).toBe("Meta+Z");
  });

  it("maps Ctrl to Ctrl elsewhere", () => {
    expect(comboFromEvent(key({ key: "k", code: "KeyK", ctrlKey: true }), false)).toBe("Ctrl+K");
  });

  it("uses physical keys for punctuation so Shift does not change them", () => {
    expect(comboFromEvent(key({ key: "?", code: "Slash", shiftKey: true, ctrlKey: true }), false)).toBe("Ctrl+Shift+/");
    expect(comboFromEvent(key({ key: "+", code: "Equal", shiftKey: true }), false)).toBe("Shift+=");
    expect(comboFromEvent(key({ key: "|", code: "Backslash", shiftKey: true }), false)).toBe("Shift+\\");
  });

  it("names navigation keys like Qt", () => {
    expect(comboFromEvent(key({ key: "ArrowLeft", code: "ArrowLeft" }), false)).toBe("Left");
    expect(comboFromEvent(key({ key: " ", code: "Space" }), false)).toBe("Space");
    expect(comboFromEvent(key({ key: "Delete", code: "Delete", shiftKey: true }), false)).toBe("Shift+Delete");
  });

  it("uses the typed letter even when Alt changes the character on macOS", () => {
    expect(comboFromEvent(key({ key: "˚", code: "KeyK", altKey: true, shiftKey: true }), true)).toBe("Alt+Shift+K");
  });

  it("ignores bare modifiers", () => {
    expect(comboFromEvent(key({ key: "Shift", code: "ShiftLeft", shiftKey: true }), false)).toBeNull();
  });
});

describe("keymap", () => {
  it("contains the desktop defaults the brief lists", () => {
    const keymap = buildKeymap();
    expect(keymap.get("playToggle")).toEqual(["Space", "Up", "Down", "K"]);
    expect(keymap.get("actionRazorTool")).toEqual(["C", "B", "R"]);
    expect(keymap.get("actionSnappingTool")).toEqual(["S"]);
    expect(keymap.get("actionAddMarker")).toEqual(["M"]);
    expect(keymap.get("sliceSelectedKeepBothSides")).toEqual(["Ctrl+K"]);
    expect(keymap.get("actionRippleDelete")).toEqual(["Shift+Delete"]);
    expect(keymap.get("actionTimelineZoomIn")).toEqual(["=", "Ctrl+="]);
    expect(keymap.get("actionZoomToTimeline")).toEqual(["\\", "Shift+\\"]);
    expect(keymap.get("actionUndo")).toEqual(["Ctrl+Z"]);
    expect(keymap.get("actionRedo")).toEqual(["Ctrl+Shift+Z"]);
    expect(keymap.get("nudgeLeftBig")).toEqual(["Ctrl+Shift+Left"]);
  });

  it("has no two desktop actions on the same combo", () => {
    const byCombo = invertKeymap(buildKeymap());
    const clashes = [...byCombo.entries()].filter(([, actions]) => actions.length > 1);
    expect(clashes).toEqual([]);
  });

  it("parses every desktop binding", () => {
    for (const [action, text] of Object.entries(DESKTOP_KEYMAP)) {
      expect(parseBindings(text).length, action).toBe(text.split("|").length);
    }
  });

  it("gives the first binding as primary", () => {
    expect(primaryShortcut(buildKeymap(), "actionExportVideo")).toBe("Ctrl+E");
  });

  it("lets overrides replace a binding", () => {
    expect(buildKeymap({ actionAddMarker: "Shift+M" }).get("actionAddMarker")).toEqual(["Shift+M"]);
  });
});

describe("formatShortcut", () => {
  it("uses symbols on macOS", () => {
    expect(formatShortcut("Ctrl+Shift+Z", true)).toEqual(["⌘", "⇧", "Z"]);
    expect(shortcutLabel("Ctrl+Shift+Z", true)).toBe("⌘⇧Z");
  });

  it("uses names elsewhere", () => {
    expect(shortcutLabel("Ctrl+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("Shift+Delete", false)).toBe("Shift+Del");
  });
});

describe("dispatcher", () => {
  function setup(commands: ShortcutCommand[]) {
    const map = new Map(commands.map((c) => [c.id, c]));
    return createDispatcher({ keymap: buildKeymap(), commands: () => map, mac: false });
  }

  it("runs the bound command and prevents the default", () => {
    const run = vi.fn();
    const dispatcher = setup([{ id: "playToggle", run }]);
    const e = event({ key: " ", code: "Space" });
    expect(dispatcher.handle(e)).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("ignores keys typed into text fields unless the command allows it", () => {
    const play = vi.fn();
    const save = vi.fn();
    const dispatcher = setup([
      { id: "playToggle", run: play },
      { id: "actionSave", run: save, allowInInputs: true },
    ]);
    const input = document.createElement("input");
    expect(isEditableTarget(input)).toBe(true);
    expect(dispatcher.handle(event({ key: " ", code: "Space", target: input }))).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(dispatcher.handle(event({ key: "s", code: "KeyS", ctrlKey: true, target: input }))).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it("swallows auto-repeat for toggles but repeats frame steps", () => {
    const toggle = vi.fn();
    const step = vi.fn();
    const dispatcher = setup([
      { id: "actionRazorTool", run: toggle },
      { id: "seekNextFrame", run: step, allowRepeat: true },
    ]);
    expect(dispatcher.handle(event({ key: "c", code: "KeyC", repeat: true }))).toBe(true);
    expect(toggle).not.toHaveBeenCalled();
    dispatcher.handle(event({ key: "ArrowRight", code: "ArrowRight", repeat: true }));
    expect(step).toHaveBeenCalledOnce();
  });

  it("lets disabled commands fall through", () => {
    const dispatcher = setup([{ id: "actionUndo", run: vi.fn(), enabled: () => false }]);
    const e = event({ key: "z", code: "KeyZ", ctrlKey: true });
    expect(dispatcher.handle(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves keys alone inside menus and dialogs", () => {
    const run = vi.fn();
    const dispatcher = setup([{ id: "seekNextFrame", run }]);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    menu.append(item);
    document.body.append(menu);
    expect(dispatcher.handle(event({ key: "ArrowRight", code: "ArrowRight", target: item }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
    menu.remove();
  });
});
