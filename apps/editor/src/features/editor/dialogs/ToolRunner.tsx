/**
 * Run an engine tool by hand: a form generated from the tool's JSON Schema
 * (the same catalog the Assistant uses), executed through the Assistant
 * bridge so results and undo steps are identical.
 */
import { CONTRACT_TOOL_NAMES, contractMeta, HIDDEN_PARAMS, type ContractToolName } from "@zenvi/engine/tools";
import { useMemo, useState } from "react";
import { Button } from "@/ui/Button";
import { Switch } from "@/ui/Controls";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Input";
import { Select } from "@/ui/Select";
import { toast } from "@/ui/Toast";
import { runAssistantTool } from "../assistant/bridge";
import { createToolHost } from "../assistant/host";
import { useSession } from "../session/context";

interface FieldSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  title?: string;
}

export interface ToolEntry {
  name: ContractToolName;
  title: string;
  description: string;
}

/** Tools a person can run from the palette (the Assistant's own catalog). */
export function toolEntries(): ToolEntry[] {
  return CONTRACT_TOOL_NAMES.map((name) => ({ name, title: contractMeta[name].title || name, description: contractMeta[name].description })).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
}

function kindOf(schema: FieldSchema): "boolean" | "number" | "enum" | "text" {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "enum";
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("boolean")) return "boolean";
  if (types.includes("number") || types.includes("integer")) return "number";
  return "text";
}

export function ToolRunnerDialog({ name, onClose }: { name: ContractToolName | null; onClose: () => void }) {
  const session = useSession();
  const meta = name ? contractMeta[name] : null;
  const fields = useMemo(() => {
    if (!meta) return [];
    const hidden = new Set<string>(HIDDEN_PARAMS as Iterable<string>);
    const required = new Set((meta.inputSchema as { required?: string[] }).required ?? []);
    return Object.entries(meta.inputSchema.properties)
      .filter(([key]) => !hidden.has(key))
      .map(([key, schema]) => ({ key, schema: schema as FieldSchema, required: required.has(key) }));
  }, [meta]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    if (!name) return;
    setBusy(true);
    setResult(null);
    try {
      const args = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined));
      const wire = await runAssistantTool(session, createToolHost(session, async () => []), name, args, new AbortController().signal, "editor");
      let text = wire.result;
      try {
        const parsed = JSON.parse(text) as { summary?: unknown };
        if (typeof parsed.summary === "string") text = parsed.summary;
      } catch {
        // plain text result
      }
      setResult(text);
      if (text.startsWith("Error")) toast.error(meta?.title ?? name, { description: text.replace(/^Error:\s*/, "") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={name !== null}
      onOpenChange={(o) => {
        if (!o) {
          setValues({});
          setResult(null);
          onClose();
        }
      }}
      title={meta?.title ?? "Tool"}
      description={meta?.description.split("\n")[0]}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" loading={busy} disabled={fields.some((f) => f.required && (values[f.key] === undefined || values[f.key] === ""))} onClick={() => void run()}>
            Run
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {fields.length === 0 ? <p className="text-sm text-fg-subtle">This tool has no options.</p> : null}
        {fields.map(({ key, schema, required }) => {
          const kind = kindOf(schema);
          const label = `${schema.title ?? key.replace(/_/g, " ")}${required ? " *" : ""}`;
          return (
            <label key={key} className="block space-y-1">
              <span className="text-xs text-fg-subtle">{label}</span>
              {kind === "boolean" ? (
                <div>
                  <Switch label={label} checked={Boolean(values[key] ?? schema.default)} onCheckedChange={(v) => setValues((s) => ({ ...s, [key]: v }))} />
                </div>
              ) : kind === "enum" ? (
                <Select<string>
                  ariaLabel={label}
                  value={String(values[key] ?? schema.default ?? schema.enum![0])}
                  options={schema.enum!.map((v) => ({ value: String(v), label: String(v) }))}
                  onChange={(v) => setValues((s) => ({ ...s, [key]: v }))}
                  className="w-full"
                />
              ) : (
                <TextInput
                  value={String(values[key] ?? "")}
                  inputMode={kind === "number" ? "decimal" : undefined}
                  placeholder={schema.default !== undefined && schema.default !== "" ? String(schema.default) : undefined}
                  onChange={(e) => setValues((s) => ({ ...s, [key]: e.target.value }))}
                />
              )}
              {schema.description ? <span className="block text-2xs text-fg-faint">{schema.description}</span> : null}
            </label>
          );
        })}
        {result ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-black/40 px-3 py-2 font-mono text-xs text-fg-muted">{result}</pre> : null}
      </div>
    </Dialog>
  );
}
