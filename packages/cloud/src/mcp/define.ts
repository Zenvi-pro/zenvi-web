/**
 * `defineTool`: a cloud MCP tool from zod input/output schemas and a handler.
 * Arguments are validated before the handler runs; ApiErrors become error
 * results with their message; anything unexpected is logged and reported
 * without internals.
 */

import type { ToolImage } from "@zenvi/engine";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ApiError } from "../http/errors.js";
import { errorMessage } from "../http/log.js";
import { errorResult, okResult } from "./results.js";
import type { ExplicitAnnotations, JsonSchemaObject, McpCallContext, McpTool } from "./types.js";

export function jsonSchema(schema: z.ZodType, io: "input" | "output"): JsonSchemaObject {
  const generated = z.toJSONSchema(schema, { target: "draft-7", io, unrepresentable: "any" }) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = generated;
  return { ...rest, type: "object" };
}

export interface ToolOutcome<O> {
  text: string;
  data: O;
  images?: ToolImage[];
  /** The result's `_meta`: for the tool's view only, never shown to the model. */
  meta?: Record<string, unknown>;
}

export interface ToolSpec<I extends z.ZodObject, O extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  annotations: Omit<ExplicitAnnotations, "title">;
  scope: string;
  /** Status lines ChatGPT shows while/after the tool runs (≤ 64 chars). */
  invoking?: string;
  invoked?: string;
  meta?: Record<string, unknown>;
  run(ctx: McpCallContext, input: z.infer<I>): Promise<ToolOutcome<z.infer<O>>>;
}

export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
    .join("; ");
}

export async function guard(ctx: McpCallContext, name: string, body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ApiError) return errorResult(error.message);
    ctx.services.log.error("mcp tool failed", { tool: name, error: errorMessage(error) });
    return errorResult(`${name} failed unexpectedly. Try again in a moment.`);
  }
}

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(spec: ToolSpec<I, O>): McpTool {
  const meta: Record<string, unknown> = { ...(spec.meta ?? {}) };
  if (spec.invoking) meta["openai/toolInvocation/invoking"] = spec.invoking.slice(0, 64);
  if (spec.invoked) meta["openai/toolInvocation/invoked"] = spec.invoked.slice(0, 64);
  meta.securitySchemes = [{ type: "oauth2", scopes: [spec.scope] }];
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: jsonSchema(spec.input, "input"),
    outputSchema: jsonSchema(spec.output, "output"),
    annotations: { title: spec.title, ...spec.annotations },
    _meta: meta,
    scope: spec.scope,
    call: (ctx, args) =>
      guard(ctx, spec.name, async () => {
        // An argument the tool does not know is an error, not silently dropped:
        // the caller meant something by it (e.g. a `profile` the tool lacked).
        const known = Object.keys(spec.input.shape);
        const unknown = Object.keys(args).filter((key) => !known.includes(key));
        if (unknown.length > 0) {
          return errorResult(`Unknown argument${unknown.length > 1 ? "s" : ""} for ${spec.name}: ${unknown.join(", ")}. Accepted: ${known.join(", ")}.`);
        }
        const parsed = spec.input.safeParse(args);
        if (!parsed.success) return errorResult(`Invalid arguments for ${spec.name}: ${describeIssues(parsed.error)}`);
        const outcome = await spec.run(ctx, parsed.data);
        return okResult(outcome.text, outcome.data as Record<string, unknown>, outcome.images, outcome.meta);
      }),
  };
}
