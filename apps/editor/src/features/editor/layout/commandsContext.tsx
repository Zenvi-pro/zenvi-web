import { createContext, useContext } from "react";
import type { EditorCommand } from "../commands";

export const CommandsContext = createContext<Map<string, EditorCommand> | null>(null);

export function useCommands(): Map<string, EditorCommand> {
  const commands = useContext(CommandsContext);
  if (!commands) throw new Error("useCommands outside the editor");
  return commands;
}

/** Run a command by id (no-op when unknown or disabled). */
export function useRunCommand(): (id: string) => void {
  const commands = useCommands();
  return (id) => {
    const command = commands.get(id);
    if (command && (!command.enabled || command.enabled())) command.run();
  };
}
