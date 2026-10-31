/**
 * The director card: the zenvi-motion-director skill
 * (plugins/zenvi/skills/zenvi-motion-director) cut to what an agent must not
 * miss, for the MCP servers' `instructions` (sent at initialize, so every
 * client sees it whether or not it loads a skill). Bench round 5: agents that
 * never opened the recipe left grade and sound to chance. It must stay under
 * 400 tokens: 366 on Claude Sonnet 5.5 at 926 characters (Bedrock
 * converse usage, 2026-10-28), so the CLI's test bounds it at 1000
 * characters. The craft is behind find_style_tool and get_style_tool
 * (the styles library, read on demand), not in the card. DIRECTOR_CARD
 * and DIRECTOR_START go out only from the CLI's `zenvi mcp`, where
 * render_video exists; FINISH_HINT is in engine tool descriptions on
 * every surface, so it names Zenvi Cloud's render_project too.
 */

/** The finish, for the descriptions of the tools that start a whole video (on every surface: Zenvi Cloud renders with render_project). */
export const FINISH_HINT =
  "Then finish, in order, skipping what its receipt says it did: unify_grade_tool, apply_motion_transitions_tool, spot_sound_tool and auto_sound_design_tool, master_audio_tool iterate=true, render (render_video; Zenvi Cloud: render_project), review_render_tool where available, watch_render_tool once on the render (its path; Zenvi Cloud: the render_id) where available: fix its HIGH issues, render, watch again at most once.";

/**
 * The style router: the styles library through its tools (styles.ts), on
 * every surface. Fleet ab10: with the recipes named here and read through
 * read_director_recipe, no agent ever opened a zenvi-styles file. Said as
 * the first step with the calls written out: W70's first runs, told only
 * what the tools do, skipped them.
 */
const STYLE =
  'Before the first edit: find_style_tool {"request": "<the person\'s words>"}, then get_style_tool {"style": "<its pick>", "length_seconds": <the length>}: the beats timed for that length, look, type, sound, the exact tool calls and the checklist. get_technique_tool for a technique the style borrows.';

/** The brief (plugins/zenvi/skills/zenvi-styles/BRIEF.md): it lets review check the edit; nothing waits for it. */
const BRIEF = "A brief lets review check the edit: save_brief_tool, get_brief_tool (nothing waits for it: the first cut saves a minimal one).";

/** The finish every recipe ends with, in order. */
const FINISH =
  "Finish, in order: unify_grade_tool; apply_motion_transitions_tool (no track = every scene change; match cuts stay hard); spot_sound_tool, auto_sound_design_tool (genre, beats); " +
  "master_audio_tool iterate=true, last; render_video; review_render_tool; watch_render_tool once, fix its HIGH issues. Make the calls receipts say are missing.";

/**
 * Re-edit bench (2026-10-28): agents given a bin of finished shots cut them in
 * bin order (Kendall tau -0.14 against the editor's) and never opened a skill.
 */
const ORDER = "Shots to re-edit: sequence_shots_tool first.";

export const DIRECTOR_CARD: string = [
  `Whole videos (reel, ad, promo, montage, a remake): ${STYLE} ${BRIEF}`,
  ORDER,
  FINISH,
  "TTS captions: kinetic_captions_tool timeline_clip_ids=[TTS clip] uses its word timings.",
].join("\n");

/** The one-call builders: a whole first cut in one undo step, then the recipe's fixes and the finish. */
const BUILDERS =
  "A whole first cut in one call (one undo step, every decision in its receipt), then fix single shots and finish: build_reel_tool (cut to music), build_trailer_tool (movie or game trailer), " +
  "build_explainer_tool (voice-over explainer, documentary, video essay), build_talking_head_tool (someone talking to camera), build_product_launch_tool (product launch, SaaS or app promo).";

/** Best of three (the skill's "Best of three"): only here, the card is at its budget. */
const BEST_OF =
  "60 s or shorter and watching works: make the base and two variants that differ on one axis of the brief (pacing, type, grade or music) with fork_project_tool, render 540 px proxies, pick_best_variant_tool from the base, then fix the winner's 3 fixes.";

/** open_project_file's note on an empty project: the plan, where every agent reads (its first receipt). */
export const DIRECTOR_START: string = `A new edit. ${STYLE} ${BRIEF} ${BUILDERS} ${ORDER} ${FINISH} ${BEST_OF}`;
