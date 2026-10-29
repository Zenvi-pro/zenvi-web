/**
 * The common wrong names an agent sends, accepted with a warning instead of
 * refused (a refusal costs the agent a whole turn): an argument called
 * `clip_id` where the tool takes `timeline_clip_id`, an enum value that is a
 * near miss ("scale pop" for `pop`, "wipes" for `wipe`).
 *
 * Both helpers only accept what has exactly one reading. Anything ambiguous
 * returns nothing, and the caller keeps its refusal.
 */

/** Argument names agents use for another tool's argument; each maps to the schema names it may mean, in order. */
const ARGUMENT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  clip_id: ["timeline_clip_id"],
  clip_ids: ["timeline_clip_ids"],
  // trim_clip_tool and the FX tools name the same thing clip_id.
  timeline_clip_id: ["clip_id"],
  timeline_clip_ids: ["clip_ids"],
  max_results: ["count", "limit"],
  // The moment, by the name add_sfx_tool gives it (analyze_frame_colors_tool calls it time).
  at_seconds: ["time", "seconds", "time_seconds", "position_seconds"],
};

/** The same inside the objects of an array argument: list_fx_tool lists effects by `id`, apply_fx_tool's items name them `effect`. */
const ITEM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ...ARGUMENT_ALIASES,
  id: ["effect"],
};

/** An enum value sent to the wrong argument: `ease: "linear"` is the `interpolation` the tool has next to it. */
const VALUE_MOVES: Readonly<Record<string, string>> = {
  ease: "interpolation",
};

/** Old or swapped spellings of enum values, read as the value the schema has. */
const VALUE_ALIASES: Readonly<Record<string, string>> = {
  "3d_product": "product_3d",
  // The sound designer scores a documentary as a video essay.
  documentary: "video_essay",
};

export interface AliasedArguments {
  args: unknown;
  /** One line per renamed argument, for the receipt's warnings. */
  notes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SchemaNode = { properties?: Record<string, unknown>; items?: unknown; enum?: unknown; anyOf?: unknown; oneOf?: unknown };

/** The options of an enum property (a nullable one is an anyOf holding the enum). */
function enumOf(node: unknown): readonly unknown[] | undefined {
  if (!isRecord(node)) return undefined;
  if (Array.isArray(node.enum)) return node.enum;
  for (const part of [node.anyOf, node.oneOf]) {
    if (!Array.isArray(part)) continue;
    for (const option of part) {
      const found = enumOf(option);
      if (found) return found;
    }
  }
  return undefined;
}

/** A property typed as a string and not as an array. */
function takesString(node: unknown): boolean {
  if (!isRecord(node)) return false;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  return types.includes("string") && !types.includes("array") && node.anyOf === undefined && node.oneOf === undefined;
}

/** The object schema of an array property's items. */
function itemsOf(node: unknown): SchemaNode | undefined {
  if (!isRecord(node)) return undefined;
  if (isRecord(node.items) && isRecord(node.items.properties)) return node.items as SchemaNode;
  for (const part of [node.anyOf, node.oneOf]) {
    if (!Array.isArray(part)) continue;
    for (const option of part) {
      const found = itemsOf(option);
      if (found) return found;
    }
  }
  return undefined;
}

function aliasObject(properties: Record<string, unknown>, args: Record<string, unknown>, names: Readonly<Record<string, readonly string[]>>, where: string, notes: string[]): Record<string, unknown> {
  let out: Record<string, unknown> | undefined;
  const edit = (): Record<string, unknown> => (out ??= { ...args });
  for (const key of Object.keys(args)) {
    if (Object.hasOwn(properties, key)) continue;
    const targets = (names[key] ?? []).filter((name) => Object.hasOwn(properties, name));
    // One id where the tool takes only the list (separate_clip_audio_tool's timeline_clip_ids): the list of one.
    const plural = targets.length === 0 && Object.hasOwn(properties, `${key}s`) && /_ids?$/.test(key) ? `${key}s` : undefined;
    const target = targets.length === 1 ? targets[0]! : plural;
    if (!target || Object.hasOwn(args, target)) continue;
    edit()[target] = args[key];
    delete edit()[key];
    notes.push(`'${where}${key}' is not an argument of this tool; used it as '${where}${target}'. Pass '${where}${target}' next time.`);
  }
  const current = out ?? args;
  for (const [key, value] of Object.entries(current)) {
    // Ids as a list where the tool takes them comma-separated (the desktop's string arguments): one reading, no note.
    if (key.endsWith("_ids") && Array.isArray(value) && value.every((v) => typeof v === "string") && takesString(properties[key])) {
      edit()[key] = value.join(",");
      continue;
    }
    if (typeof value !== "string") continue;
    const options = enumOf(properties[key]);
    if (!options || options.includes(value)) continue;
    const alias = VALUE_ALIASES[value.trim().toLowerCase()];
    if (alias !== undefined && options.includes(alias)) {
      edit()[key] = alias;
      notes.push(`${where}${key} '${value}' is spelled '${alias}' here; used '${alias}'.`);
      continue;
    }
    const sibling = VALUE_MOVES[key];
    if (sibling === undefined || Object.hasOwn(current, sibling) || !enumOf(properties[sibling])?.includes(value)) continue;
    edit()[sibling] = value;
    delete edit()[key];
    notes.push(`'${value}' is not a value of ${where}${key}; used it as ${where}${sibling}='${value}'. Pass ${sibling} next time.`);
  }
  for (const [key, value] of Object.entries(out ?? args)) {
    const items = itemsOf(properties[key]);
    if (!items || !Array.isArray(value)) continue;
    let changed = false;
    const mapped = value.map((item, i) => {
      if (!isRecord(item)) return item;
      const next = aliasObject(items.properties!, item, ITEM_ALIASES, `${where}${key}[${i}].`, notes);
      changed ||= next !== item;
      return next;
    });
    if (changed) edit()[key] = mapped;
  }
  return out ?? args;
}

/**
 * Rename arguments the schema does not have to the one it does: `clip_id` →
 * `timeline_clip_id` when the tool has no `clip_id` and the call did not
 * also pass the real name (then the call is wrong in a way we cannot guess).
 * Inside array items too (`effects[0].id` → `effects[0].effect`), and enum
 * values: an old spelling (`3d_product`), or a value of the argument next to
 * it (`ease: "linear"` is `interpolation: "linear"`).
 */
export function aliasArguments(schema: { properties?: Record<string, unknown> } | undefined, args: unknown): AliasedArguments {
  const properties = schema?.properties;
  if (!properties || !isRecord(args)) return { args, notes: [] };
  const notes: string[] = [];
  return { args: aliasObject(properties, args, ARGUMENT_ALIASES, "", notes), notes };
}

export interface OptionMatch {
  option: string;
  /** How the guess was read: spelled as the option, a listed alias, or a near miss. */
  how: "exact" | "alias" | "near";
}

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const squash = (text: string): string => words(text).join("_");

function oneOf(matches: readonly string[]): string | undefined {
  const distinct = [...new Set(matches)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    // Two letters swapped.
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/**
 * The option a guess means, or undefined when it means none or several.
 * Spelling is forgiven (case, spaces, hyphens, a plural, one typo), `aliases`
 * (a block's own table: old names, synonyms) are honoured, and a phrase that
 * contains exactly one option as a word counts as that option ("scale pop").
 */
export function matchOption(guess: string, options: readonly string[], aliases?: Readonly<Record<string, string>>): OptionMatch | undefined {
  const key = squash(guess);
  if (!key) return undefined;
  const byKey = new Map(options.map((option) => [squash(option), option] as const));
  const exact = byKey.get(key);
  if (exact !== undefined) return { option: exact, how: "exact" };

  for (const [name, target] of Object.entries(aliases ?? {})) {
    if (squash(name) === key && options.includes(target)) return { option: target, how: "alias" };
  }

  const near = (option: string | undefined): OptionMatch | undefined => (option === undefined ? undefined : { option, how: "near" });

  // "wipes" for "wipe", "dot" for "dots".
  const plural = oneOf([...byKey].filter(([k]) => k === `${key}s` || `${k}s` === key || k === `${key}es` || `${k}es` === key).map(([, option]) => option));
  if (plural !== undefined) return near(plural);

  // "scale pop" holds the word "pop"; "over the video" holds the words of "over_video".
  const guessWords = new Set(words(guess));
  if (["no", "not", "non", "without"].some((w) => guessWords.has(w))) return undefined;
  const contained = [...byKey].filter(([k]) => k.split("_").every((w) => guessWords.has(w)));
  if (contained.length > 0) {
    // The longest option wins over its own parts ("over_video" over "video"), but two equals are ambiguous.
    const longest = Math.max(...contained.map(([k]) => k.split("_").length));
    const best = contained.filter(([k]) => k.split("_").length === longest).map(([, option]) => option);
    return near(oneOf(best));
  }

  // One typo in a word long enough that it cannot be another word.
  if (key.length >= 5) return near(oneOf([...byKey].filter(([k]) => k.length >= 4 && withinOneEdit(key, k)).map(([, option]) => option)));
  return undefined;
}
