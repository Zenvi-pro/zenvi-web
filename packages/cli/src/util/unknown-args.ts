/**
 * Refuse argument names a tool does not declare. MCP SDK servers that publish
 * raw JSON schemas do not validate them, and silently dropping an argument
 * hides the mistake (a model that sends `output_path` must learn the real
 * name, not get a render somewhere else).
 */

/** "Error: unknown argument(s) for <tool>: a, b. Accepted: …", or undefined when every name is declared. */
export function unknownArgumentsMessage(tool: string, args: Record<string, unknown> | undefined, schema: { properties?: Record<string, unknown> } | undefined): string | undefined {
  const known = Object.keys(schema?.properties ?? {});
  const unknown = Object.keys(args ?? {}).filter((key) => !known.includes(key));
  if (unknown.length === 0) return undefined;
  return `Error: unknown argument${unknown.length > 1 ? "s" : ""} for ${tool}: ${unknown.join(", ")}. Accepted: ${known.join(", ") || "none"}.`;
}
