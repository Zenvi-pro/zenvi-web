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
};

export interface AliasedArguments {
  args: unknown;
  /** One line per renamed argument, for the receipt's warnings. */
  notes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rename arguments the schema does not have to the one it does: `clip_id` →
 * `timeline_clip_id` when the tool has no `clip_id` and the call did not
 * also pass the real name (then the call is wrong in a way we cannot guess).
 */
export function aliasArguments(schema: { properties?: Record<string, unknown> } | undefined, args: unknown): AliasedArguments {
  const properties = schema?.properties;
  if (!properties || !isRecord(args)) return { args, notes: [] };
  const notes: string[] = [];
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(args)) {
    if (Object.hasOwn(properties, key)) continue;
    const targets = (ARGUMENT_ALIASES[key] ?? []).filter((name) => Object.hasOwn(properties, name));
    const target = targets.length === 1 ? targets[0]! : undefined;
    if (!target || Object.hasOwn(args, target)) continue;
    out ??= { ...args };
    out[target] = out[key];
    delete out[key];
    notes.push(`'${key}' is not an argument of this tool; used it as '${target}'. Pass '${target}' next time.`);
  }
  return { args: out ?? args, notes };
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
