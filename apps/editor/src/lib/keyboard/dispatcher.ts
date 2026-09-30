import { comboFromEvent, isMacPlatform, type KeyLike } from "./combo";
import { invertKeymap, type Keymap } from "./keymap";

export interface ShortcutCommand {
  id: string;
  run(): void;
  /** Checked at dispatch; a disabled command lets the key fall through. */
  enabled?(): boolean;
  /** Fire again while the key auto-repeats (frame stepping, nudging). */
  allowRepeat?: boolean;
  /** Fire even when focus is in a text field (Save). */
  allowInInputs?: boolean;
}

export interface KeyEventLike extends KeyLike {
  repeat: boolean;
  target: EventTarget | null;
  defaultPrevented: boolean;
  preventDefault(): void;
}

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);

/** True when typing in `target` should not trigger editor shortcuts. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return false;
}

/** Menus and dialogs own their keys (arrow navigation, Escape). */
export function isInsideOverlay(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return (target as Element).closest('[role="menu"],[role="menubar"],[role="listbox"],[role="dialog"],[role="alertdialog"]') !== null;
}

export interface Dispatcher {
  /** Handle a keydown. Returns true when a command ran (the event is then prevented). */
  handle(event: KeyEventLike): boolean;
  /** Action ids bound to `combo`. */
  actionsFor(combo: string): readonly string[];
}

export function createDispatcher(options: {
  keymap: Keymap;
  commands: () => ReadonlyMap<string, ShortcutCommand>;
  mac?: boolean;
}): Dispatcher {
  const byCombo = invertKeymap(options.keymap);
  const mac = options.mac ?? isMacPlatform();
  return {
    actionsFor(combo) {
      return byCombo.get(combo) ?? [];
    },
    handle(event) {
      if (event.defaultPrevented) return false;
      const combo = comboFromEvent(event, mac);
      if (!combo) return false;
      const actions = byCombo.get(combo);
      if (!actions) return false;
      const editable = isEditableTarget(event.target);
      const overlay = isInsideOverlay(event.target);
      const commands = options.commands();
      for (const action of actions) {
        const command = commands.get(action);
        if (!command) continue;
        if ((editable || overlay) && !command.allowInInputs) continue;
        if (command.enabled && !command.enabled()) continue;
        event.preventDefault();
        if (event.repeat && !command.allowRepeat) return true;
        command.run();
        return true;
      }
      return false;
    },
  };
}
