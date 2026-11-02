/**
 * The scene starters a cinetic style's film is drafted from (zenvi-styles
 * families/zenvi-scenes.md). Each is a worked example of the styles library:
 * its technique file's ```ts block is the scene module, so the skill an
 * agent reads and the draft produce_video_tool renders are the same code.
 * The draft takes the request's name and copy as params; the example's own
 * story objects stay until the agent rewrites the scene for the product.
 */

export const SCENE_STARTERS = ["scenes-launch-teaser", "scenes-feature-loop", "scenes-logo-sting"] as const;
export type SceneStarter = (typeof SCENE_STARTERS)[number];

/** A starter whose length is a `const SECONDS = n;` line is cut to the asked length within these bounds. */
const SECONDS_LINE = /^const SECONDS = \d+(?:\.\d+)?;$/m;
const MIN_SECONDS = 12;
const MAX_SECONDS = 45;

export interface StarterModule {
  code: string;
  /** Set when the starter took the asked length (else it keeps its own). */
  seconds: number | null;
}

/** The starter's module from its technique file's markdown, at `seconds` where it can be; null when the file has no ```ts block. */
export function starterModule(markdown: string, seconds: number): StarterModule | null {
  const block = /```ts\n([\s\S]*?)\n```/.exec(markdown);
  if (!block) return null;
  const code = block[1]!;
  if (!SECONDS_LINE.test(code)) return { code, seconds: null };
  const length = Math.round(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, seconds)));
  return { code: code.replace(SECONDS_LINE, `const SECONDS = ${length};`), seconds: length };
}

export interface StarterFacts {
  name: string | null;
  hook: string | null;
  features: readonly string[];
}

/**
 * What the draft says, from the request. A string the request does not
 * give is emptied where the starter draws its absence (the teaser's rows
 * become bars) rather than left as the example's copy about another product.
 */
export function starterParams(starter: SceneStarter, facts: StarterFacts): Record<string, unknown> {
  const name = facts.name ?? "";
  switch (starter) {
    case "scenes-launch-teaser":
      return { name, app: name, view: "", tagline: facts.hook ?? "", hook: [], proof: facts.features.slice(0, 2), items: [...facts.features], keep: [0], unit: "" };
    case "scenes-feature-loop":
      return name ? { app: name } : {};
    case "scenes-logo-sting":
      return { ...(name ? { name } : {}), tagline: facts.hook ?? "" };
  }
}
