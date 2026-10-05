export interface ManifestRow {
  name: string;
  label: string;
  description: string;
  input_schema: Record<string, unknown>;
  read_only?: boolean;
}

export interface HandoffEntry {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: boolean };
  source: "zenvi-core" | "spec";
}

export declare const GEN_FILE: string;
export declare const HANDOFF_TOOLS: string[];
export declare const ANNOTATION_OVERRIDES: Record<string, { readOnlyHint?: boolean; destructiveHint?: boolean; why: string }>;
export declare function annotationsFor(row: ManifestRow): HandoffEntry["annotations"];
export declare function fromManifest(row: ManifestRow): HandoffEntry;
export declare function syncText(
  manifest: { tools?: ManifestRow[]; source?: string; manifest_version?: number },
  currentText: string,
  label?: string,
): { text: string; kept: string[] };
