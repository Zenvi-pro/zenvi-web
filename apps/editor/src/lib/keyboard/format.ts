import { isMacPlatform, parseCombo } from "./combo";

const MAC_SYMBOLS: Record<string, string> = {
  Ctrl: "⌘",
  Alt: "⌥",
  Shift: "⇧",
  Meta: "⌃",
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
  Delete: "⌦",
  Backspace: "⌫",
  Return: "↩",
  Esc: "esc",
  Space: "Space",
  Tab: "⇥",
  "Page Up": "PgUp",
  "Page Down": "PgDn",
};

const PC_NAMES: Record<string, string> = {
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
  Delete: "Del",
  Backspace: "⌫",
  Return: "Enter",
  Meta: "Win",
  "Page Up": "PgUp",
  "Page Down": "PgDn",
};

/** Key caps for display: ["⌘", "⇧", "K"] on macOS, ["Ctrl", "Shift", "K"] elsewhere. */
export function formatShortcut(combo: string, mac: boolean = isMacPlatform()): string[] {
  const canonical = parseCombo(combo) ?? combo;
  const parts = canonical === "+" ? ["+"] : canonical.split(/\+(?!$)/);
  const names = mac ? MAC_SYMBOLS : PC_NAMES;
  return parts.map((part) => names[part] ?? part);
}

/** One-line label, e.g. "⌘⇧K" or "Ctrl+Shift+K". */
export function shortcutLabel(combo: string, mac: boolean = isMacPlatform()): string {
  const parts = formatShortcut(combo, mac);
  return mac ? parts.join("") : parts.join("+");
}
