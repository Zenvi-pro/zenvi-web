/**
 * The JSON Schema subset tool input schemas use (draft 2020-12). The contract
 * schemas are generated from zenvi-core's TOOL_SCHEMAS and editor tool
 * schemas (schemas.gen.ts); MCP servers publish them as `inputSchema`, and
 * argument coercion reads their property types the way zenvi-core
 * `normalize_args` does.
 */

export type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface JsonSchema {
  type?: JsonSchemaType | readonly JsonSchemaType[];
  description?: string;
  enum?: readonly (string | number | boolean | null)[];
  /** Documentation only: handlers apply their own defaults. */
  default?: JsonValue;
  /**
   * OpenAPI's keyword, which zenvi-core's editor tools set next to a `type`
   * that lists "null". Not a JSON Schema keyword: validation reads `type`.
   */
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  items?: JsonSchema;
  properties?: { readonly [key: string]: JsonSchema };
  required?: readonly string[];
  additionalProperties?: boolean;
  oneOf?: readonly JsonSchema[];
  anyOf?: readonly JsonSchema[];
}

/** A tool's whole input: an object that refuses unknown keys. */
export interface JsonSchemaObject extends JsonSchema {
  type: "object";
  properties: { readonly [key: string]: JsonSchema };
  additionalProperties: false;
}

/** Every JSON type a property accepts (`type`, or the union of `oneOf`/`anyOf` branches). */
export function schemaTypes(schema: JsonSchema | undefined): Set<JsonSchemaType> {
  const out = new Set<JsonSchemaType>();
  if (!schema) return out;
  const raw = schema.type;
  if (typeof raw === "string") out.add(raw);
  else if (Array.isArray(raw)) for (const t of raw) out.add(t);
  for (const branch of [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) {
    for (const t of schemaTypes(branch)) out.add(t);
  }
  return out;
}
