/**
 * The scene lint: what an agent's scene code may use, checked before any
 * of it runs. TypeScript is stripped (Node's own type stripping), then the
 * module is parsed (acorn) and walked with real scopes: a name that is not
 * declared in the scene must be one of a few pure globals (Math, Number, JSON, Path2D…),
 * so the wall clock, randomness, timers, the network, the DOM and dynamic
 * code are refused by construction rather than by a list of bans. Members
 * that lead out of the sandbox (`constructor`, `__proto__`, `ownerDocument`,
 * `ctx.canvas`) and `Math.random` are refused by name; the page also takes
 * them away at run time (scene/page.ts), so a computed name finds nothing.
 *
 * This is one layer: the scene still runs only inside headless Chrome with
 * the network blocked, a heap limit and a per-frame time limit (scene-render.ts).
 */

import { parse, type Node as AcornNode } from "acorn";
import { SCENE_LIMITS } from "../scene/contract.js";

/** Globals a scene may name: pure computation and Canvas geometry, nothing that observes or reaches the world. */
export const SCENE_GLOBALS: ReadonlySet<string> = new Set([
  "Math", "Number", "String", "Boolean", "Array", "Object", "JSON", "Map", "Set", "WeakMap", "WeakSet", "Symbol",
  "Infinity", "NaN", "undefined", "isFinite", "isNaN", "parseFloat", "parseInt",
  "Error", "TypeError", "RangeError",
  "Path2D", "DOMMatrix",
  "Float32Array", "Float64Array", "Int8Array", "Int16Array", "Int32Array", "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array",
]);

/** Members refused by name: each leads from a value the scene holds to the page, the DOM or the Function constructor. */
const BANNED_MEMBERS: Readonly<Record<string, string>> = {
  constructor: "reaches the Function constructor",
  __proto__: "rewires prototypes",
  prototype: "rewires prototypes",
  __defineGetter__: "rewires prototypes",
  __defineSetter__: "rewires prototypes",
  __lookupGetter__: "reads hidden accessors",
  __lookupSetter__: "reads hidden accessors",
  ownerDocument: "reaches the page",
  defaultView: "reaches the page",
  getRootNode: "reaches the page",
  canvas: "reaches the page (use api.W and api.H for the frame size)",
};

/** The names a scene module may export. */
export const SCENE_EXPORTS = ["fps", "duration", "cues", "params", "alpha", "draw", "title"] as const;

export interface LintProblem {
  code: "size" | "compile" | "banned" | "exports";
  message: string;
  /** Line of the scene's source. */
  line?: number;
}

export type LintResult = { ok: true; body: string; exports: SceneExport[] } | { ok: false; problems: LintProblem[] };

type N = AcornNode & Record<string, unknown>;

function isNode(value: unknown): value is N {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function children(node: N): N[] {
  const out: N[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    if (Array.isArray(value)) for (const v of value) if (isNode(v)) out.push(v);
    if (isNode(value)) out.push(value);
  }
  return out;
}

/** Names a binding pattern declares. */
function patternNames(pattern: N | null | undefined, out: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      out.add(pattern.name as string);
      return;
    case "AssignmentPattern":
      patternNames(pattern.left as N, out);
      return;
    case "RestElement":
      patternNames(pattern.argument as N, out);
      return;
    case "ArrayPattern":
      for (const e of pattern.elements as (N | null)[]) patternNames(e, out);
      return;
    case "ObjectPattern":
      for (const p of pattern.properties as N[]) patternNames(p.type === "RestElement" ? p : (p.value as N), out);
      return;
  }
}

/** `var` names of a function body (not inside nested functions). */
function varNames(node: N, out: Set<string>): void {
  if (node.type === "VariableDeclaration" && node.kind === "var") for (const d of node.declarations as N[]) patternNames(d.id as N, out);
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" || node.type === "ClassBody") return;
  for (const c of children(node)) varNames(c, out);
}

/** let / const / class / function declared directly in a statement list. */
function lexicalNames(statements: readonly N[], out: Set<string>): void {
  for (let s of statements) {
    if (s.type === "ExportNamedDeclaration" && s.declaration) s = s.declaration as N;
    if (s.type === "VariableDeclaration" && s.kind !== "var") for (const d of s.declarations as N[]) patternNames(d.id as N, out);
    if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) out.add((s.id as N).name as string);
  }
}

class Linter {
  readonly problems: LintProblem[] = [];
  private readonly scopes: Set<string>[] = [];

  /** `lines[generated line - 1]`: the scene's own line (TypeScript was stripped, which moves lines). */
  constructor(private readonly lines: readonly (number | undefined)[]) {}

  private where(node: N): { line?: number } {
    const loc = node.loc as { start: { line: number } } | undefined;
    const line = loc ? this.lines[loc.start.line - 1] : undefined;
    return line !== undefined ? { line } : {};
  }

  fail(node: N, code: LintProblem["code"], message: string): void {
    if (this.problems.length < 20) this.problems.push({ code, message, ...this.where(node) });
  }

  private declared(name: string): boolean {
    return this.scopes.some((s) => s.has(name));
  }

  private withScope(names: Set<string>, run: () => void): void {
    this.scopes.push(names);
    try {
      run();
    } finally {
      this.scopes.pop();
    }
  }

  program(node: N): void {
    const names = new Set<string>();
    varNames(node, names);
    lexicalNames(node.body as N[], names);
    this.withScope(names, () => {
      for (const s of node.body as N[]) this.statement(s);
    });
  }

  private statement(node: N): void {
    switch (node.type) {
      case "ImportDeclaration":
        return this.fail(node, "banned", "imports are not available in a scene: everything it uses comes in `api` (type-only imports are fine)");
      case "ExportDefaultDeclaration":
      case "ExportAllDeclaration":
        return this.fail(node, "exports", "export the scene's parts by name (export const fps = …, export function draw …), not as a default");
      case "ExportNamedDeclaration":
        if (node.source) return this.fail(node, "banned", "re-exports from another module are not available in a scene");
        // esbuild gathers the exports into one `export { … }` of local names.
        if (!node.declaration) {
          for (const spec of node.specifiers as N[]) this.expression(spec.local as N);
          return;
        }
        return this.statement(node.declaration as N);
      case "WithStatement":
        return this.fail(node, "banned", "`with` is not allowed");
      case "DebuggerStatement":
        return this.fail(node, "banned", "`debugger` is not allowed");
      case "BlockStatement":
      case "StaticBlock": {
        const names = new Set<string>();
        lexicalNames(node.body as N[], names);
        return this.withScope(names, () => {
          for (const s of node.body as N[]) this.statement(s);
        });
      }
      case "SwitchStatement": {
        this.expression(node.discriminant as N);
        const names = new Set<string>();
        const cases = node.cases as N[];
        lexicalNames(cases.flatMap((c) => c.consequent as N[]), names);
        return this.withScope(names, () => {
          for (const c of cases) {
            if (c.test) this.expression(c.test as N);
            for (const s of c.consequent as N[]) this.statement(s);
          }
        });
      }
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const names = new Set<string>();
        const head = (node.type === "ForStatement" ? node.init : node.left) as N | null;
        if (head?.type === "VariableDeclaration" && head.kind !== "var") for (const d of head.declarations as N[]) patternNames(d.id as N, names);
        return this.withScope(names, () => this.generic(node));
      }
      case "TryStatement": {
        this.statement(node.block as N);
        const handler = node.handler as N | null;
        if (handler) {
          const names = new Set<string>();
          patternNames(handler.param as N | null, names);
          this.withScope(names, () => {
            if (handler.param) this.pattern(handler.param as N);
            this.statement(handler.body as N);
          });
        }
        if (node.finalizer) this.statement(node.finalizer as N);
        return;
      }
      case "FunctionDeclaration":
        return this.fn(node);
      case "ClassDeclaration":
        return this.cls(node);
      case "VariableDeclaration":
        for (const d of node.declarations as N[]) {
          this.pattern(d.id as N);
          if (d.init) this.expression(d.init as N);
        }
        return;
      case "LabeledStatement":
        return this.statement(node.body as N);
      case "BreakStatement":
      case "ContinueStatement":
      case "EmptyStatement":
        return;
      default:
        return this.generic(node);
    }
  }

  /** A binding pattern: names are declarations; defaults and computed keys are expressions. */
  private pattern(node: N | null): void {
    if (!node) return;
    switch (node.type) {
      case "Identifier":
        return;
      case "AssignmentPattern":
        this.pattern(node.left as N);
        return this.expression(node.right as N);
      case "RestElement":
        return this.pattern(node.argument as N);
      case "ArrayPattern":
        for (const e of node.elements as (N | null)[]) this.pattern(e);
        return;
      case "ObjectPattern":
        for (const p of node.properties as N[]) {
          if (p.type === "RestElement") this.pattern(p);
          else {
            this.key(p, p.key as N, p.computed === true);
            this.pattern(p.value as N);
          }
        }
        return;
      default:
        // An assignment target such as a.b in [a.b] = …
        return this.expression(node);
    }
  }

  private fn(node: N): void {
    if (node.async) this.fail(node, "banned", "async functions are not allowed: draw is a pure, synchronous function of t");
    if (node.generator) this.fail(node, "banned", "generators are not allowed");
    const names = new Set<string>();
    if (node.type === "FunctionExpression" && node.id) names.add((node.id as N).name as string);
    for (const p of node.params as N[]) patternNames(p, names);
    const body = node.body as N;
    if (body.type === "BlockStatement") {
      varNames(body, names);
      lexicalNames(body.body as N[], names);
    }
    this.withScope(names, () => {
      for (const p of node.params as N[]) this.pattern(p);
      if (body.type === "BlockStatement") for (const s of body.body as N[]) this.statement(s);
      else this.expression(body);
    });
  }

  private cls(node: N): void {
    const names = new Set<string>();
    if (node.id) names.add((node.id as N).name as string);
    if (node.superClass) this.expression(node.superClass as N);
    this.withScope(names, () => {
      for (const m of (node.body as N).body as N[]) {
        if (m.type === "StaticBlock") this.statement(m);
        else {
          this.key(m, m.key as N, m.computed === true);
          if (m.value) this.expression(m.value as N);
        }
      }
    });
  }

  private memberName(node: N, name: string, object?: N): void {
    const why = BANNED_MEMBERS[name];
    if (why) this.fail(node, "banned", `.${name} is not allowed: it ${why}`);
    if (name === "random" && object?.type === "Identifier" && object.name === "Math") this.fail(node, "banned", "Math.random is not allowed: use api.rng(…keys) so every frame draws the same");
  }

  /** A property key: a name to check, or (computed) an expression. */
  private key(node: N, key: N, computed: boolean): void {
    if (computed) {
      if (key.type === "Literal" && typeof key.value === "string") this.memberName(node, key.value);
      return this.expression(key);
    }
    if (key.type === "Identifier") this.memberName(node, key.name as string);
    else if (key.type === "Literal" && typeof key.value === "string") this.memberName(node, key.value);
  }

  private expression(node: N): void {
    switch (node.type) {
      case "Identifier": {
        const name = node.name as string;
        if (!this.declared(name) && !SCENE_GLOBALS.has(name)) {
          this.fail(node, "banned", `${name} is not available in a scene (it may name: ${[...SCENE_GLOBALS].slice(0, 12).join(", ")}…; time, randomness, media and drawing come in t and api)`);
        }
        return;
      }
      case "MemberExpression": {
        this.expression(node.object as N);
        const prop = node.property as N;
        if (node.computed) {
          if (prop.type === "Literal" && typeof prop.value === "string") this.memberName(node, prop.value, node.object as N);
          return this.expression(prop);
        }
        if (prop.type === "PrivateIdentifier") return;
        return this.memberName(node, prop.name as string, node.object as N);
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return this.fn(node);
      case "ClassExpression":
        return this.cls(node);
      case "ObjectExpression":
        for (const p of node.properties as N[]) {
          if (p.type === "SpreadElement") this.expression(p.argument as N);
          else {
            // A shorthand { a } is the reference a.
            if (p.shorthand) this.expression(p.value as N);
            else {
              this.key(p, p.key as N, p.computed === true);
              this.expression(p.value as N);
            }
          }
        }
        return;
      case "AssignmentExpression":
        this.pattern(node.left as N);
        return this.expression(node.right as N);
      case "ImportExpression":
        return this.fail(node, "banned", "import() is not available in a scene");
      case "MetaProperty":
        return this.fail(node, "banned", `${String((node.meta as N).name)}.${String((node.property as N).name)} is not available in a scene`);
      case "AwaitExpression":
      case "YieldExpression":
        return this.fail(node, "banned", "await and yield are not allowed: draw is synchronous");
      case "ThisExpression":
      case "Super":
      case "Literal":
      case "TemplateElement":
        return;
      default:
        return this.generic(node);
    }
  }

  /** A node with no scope of its own: statements stay statements, the rest are expressions. */
  private generic(node: N): void {
    for (const c of children(node)) {
      if (c.type.endsWith("Statement") || c.type === "VariableDeclaration" || c.type === "FunctionDeclaration" || c.type === "ClassDeclaration") this.statement(c);
      else if (c.type === "SwitchCase" || c.type === "CatchClause") this.generic(c);
      else this.expression(c);
    }
  }
}

/** An exported name and the local binding behind it. */
export interface SceneExport {
  name: string;
  local: string;
}

/** The module's exports, and its code with the export syntax taken off (the page wraps it in a function). */
function unexport(js: string, program: N): { body: string; exports: SceneExport[]; problems: LintProblem[] } {
  const exports: SceneExport[] = [];
  const problems: LintProblem[] = [];
  const cuts: [number, number][] = [];
  for (const s of program.body as N[]) {
    if (s.type !== "ExportNamedDeclaration" || s.source) continue;
    if (s.declaration) {
      const decl = s.declaration as N;
      const names = new Set<string>();
      if (decl.type === "VariableDeclaration") for (const d of decl.declarations as N[]) patternNames(d.id as N, names);
      else if (decl.id) names.add((decl.id as N).name as string);
      for (const name of names) exports.push({ name, local: name });
      cuts.push([s.start, decl.start]);
    } else {
      for (const spec of s.specifiers as N[]) {
        const exported = spec.exported as N;
        exports.push({ name: (exported.type === "Identifier" ? exported.name : exported.value) as string, local: (spec.local as N).name as string });
      }
      cuts.push([s.start, s.end]);
    }
  }
  for (const e of exports) if (!(SCENE_EXPORTS as readonly string[]).includes(e.name)) problems.push({ code: "exports", message: `a scene exports only ${SCENE_EXPORTS.join(", ")} (got ${e.name}); keep helpers unexported` });
  let body = "";
  let at = 0;
  for (const [from, to] of cuts.sort((x, y) => x[0] - y[0])) {
    body += js.slice(at, from);
    at = to;
  }
  body += js.slice(at);
  const names = exports.map((e) => e.name);
  for (const need of ["draw", "duration", "fps"]) if (!names.includes(need)) problems.push({ code: "exports", message: `a scene must export ${need} (export const fps = 60; export const duration = 240; export function draw(ctx, t, api) { … })` });
  return { body, exports, problems };
}

type Strip = (code: string, options?: { mode?: "strip" | "transform" }) => string;

/**
 * The scene as JavaScript, and each line's line in the scene's source.
 * Node's own type stripping (22.13+) blanks the types in place, so lines do
 * not move and nothing needs bundling (the CLI bundle has no esbuild); on an
 * older Node, esbuild with a source map.
 */
async function stripTypes(source: string): Promise<{ js: string; lines: (number | undefined)[] }> {
  const { stripTypeScriptTypes } = (await import("node:module")) as { stripTypeScriptTypes?: Strip };
  if (stripTypeScriptTypes) {
    // It is experimental and says so on stderr: not news for a person reading the CLI's output.
    const emit = process.emitWarning;
    process.emitWarning = (() => undefined) as typeof process.emitWarning;
    try {
      const js = stripTypeScriptTypes(source, { mode: "strip" });
      return { js, lines: js.split("\n").map((_, i) => i + 1) };
    } finally {
      process.emitWarning = emit;
    }
  }
  const { transform } = await import("esbuild");
  const out = await transform(source, { loader: "ts", format: "esm", target: "es2022", sourcefile: "scene.ts", sourcemap: true, logLevel: "silent" });
  return { js: out.code, lines: sourceLines(out.map) };
}

/** Strip the scene's TypeScript and lint it; on success, the module body the page runs. */
export async function lintScene(source: string): Promise<LintResult> {
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > SCENE_LIMITS.codeBytes) return { ok: false, problems: [{ code: "size", message: `the scene is ${bytes} bytes; a scene is at most ${SCENE_LIMITS.codeBytes}` }] };
  let js: string;
  let lines: (number | undefined)[];
  try {
    const stripped = await stripTypes(source);
    js = stripped.js;
    lines = stripped.lines;
  } catch (error) {
    const errors = (error as { errors?: { text: string; location?: { line: number } | null }[] }).errors ?? [];
    return { ok: false, problems: errors.length > 0 ? errors.slice(0, 10).map((e) => ({ code: "compile", message: e.text, ...(e.location ? { line: e.location.line } : {}) })) : [{ code: "compile", message: (error instanceof Error ? error.message : String(error)).split("\n")[0]! }] };
  }
  let program: N;
  try {
    program = parse(js, { ecmaVersion: 2022, sourceType: "module", locations: true }) as unknown as N;
  } catch (error) {
    return { ok: false, problems: [{ code: "compile", message: error instanceof Error ? error.message : String(error) }] };
  }
  const linter = new Linter(lines);
  linter.program(program);
  const { body, exports, problems } = unexport(js, program);
  const all = [...linter.problems, ...problems];
  return all.length > 0 ? { ok: false, problems: all } : { ok: true, body, exports };
}

/** One problem per line, the way a tool reports them. */
export function lintText(problems: readonly LintProblem[]): string {
  return problems.map((p) => `${p.line !== undefined ? `line ${p.line}: ` : ""}${p.message}`).join("\n");
}

const VLQ = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** For each generated line, the source line (1-based) of its first mapping, from a v3 source map. */
export function sourceLines(map: string): (number | undefined)[] {
  const mappings = (JSON.parse(map) as { mappings?: string }).mappings ?? "";
  const out: (number | undefined)[] = [];
  // Source-map fields are deltas across the whole map; field 2 is the source line.
  const state = [0, 0, 0, 0, 0];
  for (const line of mappings.split(";")) {
    state[0] = 0;
    let first: number | undefined;
    for (const segment of line.split(",")) {
      if (!segment) continue;
      let field = 0;
      let value = 0;
      let shift = 0;
      for (const ch of segment) {
        const digit = VLQ.indexOf(ch);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          state[field] = state[field]! + (value & 1 ? -(value >>> 1) : value >>> 1);
          field += 1;
          value = 0;
          shift = 0;
        }
      }
      if (first === undefined && field >= 3) first = state[2]! + 1;
    }
    out.push(first);
  }
  return out;
}
