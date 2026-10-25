/**
 * Motion-led reel styles: a short video built from motion templates laid on
 * the beat grid, scene by scene, each scene starting on a downbeat (a hard
 * cut on the bar). build_reel_tool plans the music window and the grid
 * exactly as for its footage styles (reels/plan.ts `planReelGrid`), then
 * places these scenes instead of cutting shots.
 *
 *   ui_promo         a search types the hook; footage rises in UI cards and a
 *                    pointer clicks; a word list scrolls; a logo end card
 *   editorial_motion an editorial sheet with the hook as kinetic type (a
 *                    letter swapped for an image tile); labelled crops of a
 *                    shot lift into a row; kinetic words; a closing card
 *   product_callout  each product shot on a dark field with leader lines out
 *                    to its features; a closing card
 *   tutorial         the hook on grid paper; one step card per clip (footage
 *                    in a card, a numbered caption, a label and arrow); "Save
 *                    this"
 *
 * Scenes have a preferred and a shortest length in bars; when the reel is
 * shorter the optional scenes go first, then scenes shrink; when it is longer
 * the closing card holds.
 */

import type { MotionContent, MotionTemplateId } from "./template.js";
import type { MotionMedia, PaletteId } from "./types.js";

export const MOTION_STYLE_IDS = ["ui_promo", "editorial_motion", "product_callout", "tutorial"] as const;
export type MotionStyleId = (typeof MOTION_STYLE_IDS)[number];

export function isMotionStyleId(value: string): value is MotionStyleId {
  return (MOTION_STYLE_IDS as readonly string[]).includes(value);
}

export interface MotionStyle {
  id: MotionStyleId;
  name: string;
  summary: string;
  defaultSeconds: number;
  /** Tempo of the grid without music. */
  defaultBpm: number;
  /** Media files the style shows at most (create_reel fetches about this many). */
  media: number;
  /** Brief lines. */
  pace: string;
  look: string;
}

export const MOTION_STYLES: Readonly<Record<MotionStyleId, MotionStyle>> = {
  ui_promo: {
    id: "ui_promo",
    name: "UI promo",
    summary:
      "Motion-designed product promo for apps and tools: a search bar types the hook, footage rises in rounded UI cards and a pointer clicks, a word list scrolls in a selection box, a logo end card. Give `words` for the word list.",
    defaultSeconds: 16,
    defaultBpm: 116,
    media: 3,
    pace: "A new scene every bar or two; every card, keystroke run and click lands on the beat",
    look: "Clean light UI, rounded cards with soft shadows, one indigo accent, a dark word-list scene",
  },
  editorial_motion: {
    id: "editorial_motion",
    name: "Editorial motion",
    summary:
      "Graphic specimen-sheet motion for fashion, design, food and objects: the hook as big kinetic type on a gridded sheet (a letter swapped for an image tile), labelled crop boxes over a shot that lift into a row, kinetic words, a closing card. Red, black and paper with one blue.",
    defaultSeconds: 14,
    defaultBpm: 108,
    media: 3,
    pace: "Words and boxes land on every beat, scenes change on the bar",
    look: "Warm paper grid with registration marks, black grotesk, signal-red tags, a blue accent",
  },
  product_callout: {
    id: "product_callout",
    name: "Product callout",
    summary:
      "Technical product reveal: each product shot on a dark field with a soft glow, an 'EXPERIMENTAL: NAME' heading, leader lines drawing out to feature labels, one per beat, then a closing card. Give `words` as features ('Foam core: 212 g').",
    defaultSeconds: 12,
    defaultBpm: 120,
    media: 2,
    pace: "One callout per beat, a new product every two bars",
    look: "Black field, dot grid, mono labels, one hot orange accent with a glow",
  },
  tutorial: {
    id: "tutorial",
    name: "Tutorial cards",
    summary:
      "A how-to in steps (9:16 first): the hook on grid paper, then one step per clip (the footage in a bordered card, a numbered caption from `labels`, a label box with an arrow from `words`), ending on 'Save this'.",
    defaultSeconds: 20,
    defaultBpm: 100,
    media: 4,
    pace: "Talk-paced: each step holds two bars, its parts arriving on the beats",
    look: "Grid paper, ink borders and hard shadows, numbered badges, a highlighter yellow",
  },
};

/** One template of a scene: what it draws and with what. */
export interface SceneTemplate {
  template: MotionTemplateId;
  palette: PaletteId;
  content: MotionContent;
}

/** A scene: from bar `bar` for `bars` bars, its templates bottom to top. */
export interface MotionScene {
  name: string;
  bar: number;
  bars: number;
  templates: SceneTemplate[];
}

export interface StoryInput {
  style: MotionStyleId;
  /** Bars in the reel (downbeat to downbeat). */
  bars: number;
  /** Visual media, in story order. */
  media: readonly MotionMedia[];
  hook?: string;
  endCard?: string;
  endCardSubtitle?: string;
  /** Per-file labels, in media order ("" for none). */
  labels?: readonly string[];
  words?: readonly string[];
}

/** A scene before its length is known. */
export interface SceneDraft {
  name: string;
  min: number;
  pref: number;
  /** Dropped first when bars run short. */
  optional: boolean;
  templates: SceneTemplate[];
}

/**
 * Lengths for the drafts in `bars`: preferred lengths; when too long, the
 * scene with the most room shrinks a bar at a time (down to its shortest;
 * on a tie a later scene, the opening and closing scenes last),
 * then optional scenes go (the last first), then middle scenes; when too
 * short, the last scene (the closing card) holds the rest.
 */
export function allocateBars(drafts: readonly SceneDraft[], bars: number): { draft: SceneDraft; bars: number }[] {
  const sized = drafts.map((d) => ({ draft: d, bars: d.pref }));
  const total = () => sized.reduce((sum, x) => sum + x.bars, 0);
  while (total() > bars) {
    // The most room first; on a tie a later scene, the closing one last (the opening sets the hook).
    const last = sized[sized.length - 1];
    const room = sized
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.bars > x.draft.min)
      .sort((a, b) => b.x.bars - b.x.draft.min - (a.x.bars - a.x.draft.min) || Number(a.x === last) - Number(b.x === last) || b.i - a.i)[0]?.x;
    if (!room) break;
    room.bars -= 1;
  }
  while (total() > bars) {
    const optional = sized.map((x) => x.draft.optional).lastIndexOf(true);
    if (optional < 0) break;
    sized.splice(optional, 1);
  }
  while (total() > bars && sized.length > 2) sized.splice(Math.floor(sized.length / 2), 1);
  while (total() > bars && sized.length > 1) sized.splice(sized.length - 2, 1);
  if (sized.length > 0) sized[sized.length - 1]!.bars = Math.max(1, sized[sized.length - 1]!.bars + bars - total());
  return sized;
}

const clean = (text: string | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";

/** The hook with one letter O (or a whole short word) swapped for an image tile, for editorial kinetic type. */
export function tiledHook(hook: string): string {
  if (hook.includes("*")) return hook;
  const words = hook.split(" ");
  // The longest word with an O inside it (not its first or last letter).
  const inner = (w: string) => w.slice(1, -1).search(/[oO0]/);
  const candidates = words.map((w, i) => ({ w, i })).filter(({ w }) => w.length >= 3 && inner(w) >= 0);
  const pick = candidates.sort((a, b) => b.w.length - a.w.length)[0];
  if (!pick) return hook;
  const at = inner(pick.w) + 1;
  words[pick.i] = `${pick.w.slice(0, at)}*${pick.w.slice(at + 1)}`;
  return words.join(" ");
}

/** Feature lines "Name: value" as callout labels and values. */
function features(words: readonly string[]): { labels: string[]; values: string[] } {
  const labels: string[] = [];
  const values: string[] = [];
  for (const w of words) {
    const [name, ...rest] = w.split(":");
    labels.push(clean(name));
    values.push(clean(rest.join(":")));
  }
  return { labels, values };
}

/** The scenes of a motion-led reel. */
export function storyboard(input: StoryInput): MotionScene[] {
  const media = input.media;
  const ids = media.map((m) => m.fileId);
  const labels = input.labels ?? [];
  const words = (input.words ?? []).map(clean).filter(Boolean);
  const hook = clean(input.hook);
  const end = clean(input.endCard);
  const sub = clean(input.endCardSubtitle);
  const drafts: SceneDraft[] = [];
  const bg = (palette: PaletteId, variant: string, extra: MotionContent = {}): SceneTemplate => ({ template: "grid_background", palette, content: { variant, ...extra } });

  switch (input.style) {
    case "ui_promo": {
      // The card captions open as suggestions under the search, then come back as the cards.
      const suggestions = ids.slice(0, 3).map((_, k) => clean(labels[k])).filter(Boolean);
      drafts.push({
        name: "search",
        min: 1,
        pref: 2,
        optional: false,
        templates: [
          bg("ui_light", "plain"),
          { template: "type_search", palette: "ui_light", content: { text: hook || "Find your next idea", button: "Search", tag: end || "Zenvi", ...(suggestions.length > 0 ? { labels: suggestions } : {}) } },
        ],
      });
      for (let i = 0; i < ids.length && i < 6; i += 3) {
        const cards = ids.slice(i, i + 3);
        drafts.push({
          name: `cards-${i / 3 + 1}`,
          min: 1,
          pref: 2,
          optional: i > 0,
          templates: [bg("ui_light", "plain"), { template: "ui_cards", palette: "ui_light", content: { fileIds: cards, labels: cards.map((_, k) => clean(labels[i + k])), ...(i === 0 ? { button: "Save" } : {}) } }],
        });
      }
      if (words.length >= 2) drafts.push({ name: "words", min: 1, pref: 2, optional: true, templates: [bg("ui_dark", "plain"), { template: "word_scroll", palette: "ui_dark", content: { words: words.slice(0, 8), text: "Made to" } }] });
      drafts.push({ name: "end", min: 1, pref: 2, optional: false, templates: [{ template: "end_card", palette: "ui_light", content: { variant: "logo", text: end || "Zenvi", ...(sub ? { subtitle: sub } : {}) } }] });
      break;
    }
    case "editorial_motion": {
      const title = (hook || "Study of form").toUpperCase();
      const corner = ["Plate 01", "Study of form", "1:1", end || "Zenvi"];
      drafts.push({
        name: "title",
        min: 1,
        pref: 2,
        optional: false,
        templates: [bg("editorial", "editorial", { labels: corner }), { template: "kinetic_type", palette: "editorial", content: { text: ids.length > 1 ? tiledHook(title) : title, fileIds: ids.slice(1).length > 0 ? ids.slice(1) : ids, tag: "Specimen_01", align: "left" } }],
      });
      if (ids.length > 0) {
        const boxLabels = labels.length > 0 ? labels.map(clean).filter(Boolean).slice(0, 4) : [];
        drafts.push({ name: "crops", min: 2, pref: 2, optional: false, templates: [{ template: "crop_labels", palette: "editorial", content: { fileIds: [ids[0]!], ...(boxLabels.length >= 2 ? { labels: boxLabels } : { tag: "Surface" }) } }] });
      }
      if (words.length > 0) {
        const kinetic = words.join(" ").toUpperCase();
        drafts.push({ name: "words", min: 1, pref: 1, optional: true, templates: [bg("editorial", "editorial", { labels: corner }), { template: "kinetic_type", palette: "editorial", content: { text: ids.length > 1 ? tiledHook(kinetic) : kinetic, fileIds: ids.slice(-2), align: "left", highlight: 0 } }] });
      }
      drafts.push({ name: "end", min: 1, pref: 2, optional: false, templates: [bg("editorial", "editorial", { labels: corner }), { template: "end_card", palette: "editorial", content: { variant: "plain", text: end || title, ...(sub ? { subtitle: sub } : {}), tag: "Specimen_01", align: "left", backdrop: false } }] });
      break;
    }
    case "product_callout": {
      const all = features(words.length > 0 ? words : ["Upper", "Core", "Base"]);
      const shots = ids.slice(0, 2);
      const perShot = shots.length > 1 ? Math.max(1, Math.ceil(all.labels.length / 2)) : Math.min(4, all.labels.length);
      const product = (i: number): SceneDraft | null => {
        const from = i * perShot;
        const names = all.labels.slice(from, from + perShot);
        if (names.length === 0 && i > 0) return null;
        return {
          name: `product-${i + 1}`,
          min: 1,
          pref: names.length > 3 ? 3 : 2,
          optional: i > 0,
          templates: [
            bg("callout", "dots"),
            {
              template: "callout",
              palette: "callout",
              content: {
                fileIds: [shots[i]!],
                text: hook || "Prototype",
                labels: names.length > 0 ? names : all.labels.slice(0, 3),
                values: all.values.slice(from, from + perShot),
                ...(i > 0 ? { points: [{ x: 0.7, y: 0.3 }, { x: 0.32, y: 0.55 }, { x: 0.66, y: 0.74 }, { x: 0.3, y: 0.24 }] } : {}),
              },
            },
          ],
        };
      };
      const first = product(0);
      if (first) drafts.push(first);
      // Between the products (or after the only one): labelled details of the shot, full frame.
      if (shots.length > 0) {
        drafts.push({ name: "details", min: 1, pref: 2, optional: true, templates: [{ template: "crop_labels", palette: "callout", content: { fileIds: [shots[shots.length - 1]!], variant: "boxes", tag: "Detail" } }] });
      }
      const second = shots.length > 1 ? product(1) : null;
      if (second) drafts.push(second);
      drafts.push({ name: "end", min: 1, pref: 2, optional: false, templates: [bg("callout", "dots"), { template: "end_card", palette: "callout", content: { variant: "plain", text: end || hook || "Prototype", ...(sub ? { subtitle: sub } : {}), tag: "Experimental", align: "center", backdrop: false } }] });
      break;
    }
    case "tutorial": {
      const title = hook || "How to do it";
      drafts.push({ name: "hook", min: 1, pref: 1, optional: false, templates: [bg("tutorial", "paper"), { template: "kinetic_type", palette: "tutorial", content: { text: title, highlight: Math.max(0, title.split(" ").length - 1), align: "center" } }] });
      ids.slice(0, 5).forEach((id, i) => {
        drafts.push({
          name: `step-${i + 1}`,
          min: 1,
          pref: 2,
          optional: i >= 2,
          templates: [bg("tutorial", "paper"), { template: "step_card", palette: "tutorial", content: { fileIds: [id], step: i + 1, text: clean(labels[i]) || `Step ${i + 1}`, ...(words[i] ? { tag: words[i] } : {}), subtitle: title } }],
        });
      });
      drafts.push({ name: "save", min: 1, pref: 2, optional: false, templates: [bg("tutorial", "paper"), { template: "end_card", palette: "tutorial", content: { variant: "save", text: end || "Save this", ...(sub ? { subtitle: sub } : { subtitle: "for later" }), backdrop: false } }] });
      break;
    }
  }

  let bar = 0;
  return allocateBars(drafts, Math.max(1, input.bars)).map(({ draft, bars }) => {
    const scene: MotionScene = { name: draft.name, bar, bars, templates: draft.templates };
    bar += bars;
    return scene;
  });
}
