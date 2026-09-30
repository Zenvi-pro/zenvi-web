/**
 * Keyboard combos in the desktop's Qt notation ("Ctrl+Shift+K", "Shift+Delete",
 * "=", "Space", "Page Up").
 *
 * Canonical form: modifiers in the order Ctrl, Alt, Shift, Meta, then one key.
 * On macOS the Command key is "Ctrl" (Qt maps Ctrl shortcuts to ⌘ on macOS),
 * and the physical Control key is "Meta".
 */

export const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
export type Modifier = (typeof MODIFIER_ORDER)[number];

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const KEY_ALIASES: Record<string, string> = {
  esc: "Esc",
  escape: "Esc",
  del: "Delete",
  delete: "Delete",
  backspace: "Backspace",
  space: "Space",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  home: "Home",
  end: "End",
  "page up": "Page Up",
  pageup: "Page Up",
  pgup: "Page Up",
  "page down": "Page Down",
  pagedown: "Page Down",
  pgdown: "Page Down",
  return: "Return",
  enter: "Return",
  tab: "Tab",
  plus: "+",
  minus: "-",
};

const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  cmd: "Ctrl",
  command: "Ctrl",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  shift: "Shift",
  meta: "Meta",
  win: "Meta",
};

function canonicalKey(raw: string): string {
  const trimmed = raw.trim();
  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed;
}

/**
 * Parse one combo ("Shift+Ctrl+Left") into canonical form ("Ctrl+Shift+Left").
 * Returns null for an empty string. A literal "+" key is written "+" or "Plus".
 */
export function parseCombo(text: string): string | null {
  const source = text.trim();
  if (!source) return null;
  // Split on "+" but keep a trailing "+" key ("Ctrl++").
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "+" && current.trim() !== "") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current !== "") parts.push(current);
  const keyPart = parts[parts.length - 1];
  if (keyPart === undefined) return null;
  const mods = new Set<Modifier>();
  for (const part of parts.slice(0, -1)) {
    const mod = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (!mod) return null;
    mods.add(mod);
  }
  const key = canonicalKey(keyPart);
  if (!key) return null;
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** Parse a desktop binding list: "C | B | R" or "Shift+C|Alt+Up". */
export function parseBindings(text: string): string[] {
  return text
    .split("|")
    .map((part) => parseCombo(part))
    .filter((combo): combo is string => combo !== null);
}

const CODE_KEYS: Record<string, string> = {
  Space: "Space",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Delete: "Delete",
  Backspace: "Backspace",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  Escape: "Esc",
  Enter: "Return",
  NumpadEnter: "Return",
  Tab: "Tab",
  Equal: "=",
  Minus: "-",
  Backslash: "\\",
  IntlBackslash: "\\",
  Comma: ",",
  Period: ".",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadMultiply: "*",
  NumpadDivide: "/",
  NumpadDecimal: ".",
};

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** The key part of an event, layout-aware for letters and positional for punctuation. */
export function eventKey(event: KeyLike): string | null {
  if (["Shift", "Control", "Alt", "Meta", "OS", "CapsLock", "Fn"].includes(event.key)) return null;
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
  const fromCode = CODE_KEYS[event.code];
  if (fromCode) return fromCode;
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad\d$/.test(event.code)) return event.code.slice(6);
  if (/^F\d{1,2}$/.test(event.code)) return event.code;
  if (event.key.length === 1) return event.key.toUpperCase();
  return null;
}

/** Canonical combo for a keyboard event, or null for a bare modifier press. */
export function comboFromEvent(event: KeyLike, mac: boolean = isMacPlatform()): string | null {
  const key = eventKey(event);
  if (!key) return null;
  const mods: Modifier[] = [];
  const ctrl = mac ? event.metaKey : event.ctrlKey;
  const meta = mac ? event.ctrlKey : event.metaKey;
  if (ctrl) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (meta) mods.push("Meta");
  return [...mods, key].join("+");
}
