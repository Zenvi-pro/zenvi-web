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
 * read_director_recipe, no agent ever opened a zenvi-styles file, but 9 of
 * 12 main runs read the recipe the card named. W70's first runs, sent to
 * find_style_tool first (two calls, no ids), read nothing: so the card names
 * the ids again and get_style_tool is one call.
 */
const STYLE =
  'Before the first edit, read its style\'s recipe: get_style_tool {"style": "<id>", "length_seconds": <s>}. ' +
  "Styles: match-cut-montage, flash-montage, hype-reel, documentary, kinetic-captions, saas-ui-promo, 3d-product-ad, editorial-type, grid-montage, data-explainer, tutorial; " +
  'find_style_tool {"request"} ranks all 42; get_technique_tool: one technique.';

/** The brief (plugins/zenvi/skills/zenvi-styles/BRIEF.md): it lets review check the edit; nothing waits for it (DIRECTOR_START only: the card is at its budget). */
const BRIEF = "A brief lets review check the edit: save_brief_tool, get_brief_tool (optional).";

/**
 * The director as code (bench rounds 6-7: a recipe read in 6 of 52 runs, a
 * builder called once, the review tools never): one call makes the edit,
 * the agent's turns go to its findings.
 */
const PRODUCE = "produce_video_tool {request: the person's words, output} does it in one call, then fix its findings.";

/**
 * Motion design with no footage (SC2 bench: agents built cinetic briefs from
 * blocks and 3D titles and never opened the style): one scene, its method and
 * worked examples behind one call.
 */
const SCENES = "Cinetic or no-footage motion design: one scene (get_technique_tool zenvi-scenes).";

/** The finish every recipe ends with, in order. */
const FINISH =
  "Finish, in order: unify_grade_tool; apply_motion_transitions_tool (no track; match cuts stay hard); spot_sound_tool, auto_sound_design_tool; " +
  "master_audio_tool iterate=true, last; render_video; review_render_tool; watch_render_tool once, fix its HIGH issues. Make the calls receipts ask for.";

/**
 * Re-edit bench (2026-10-28): agents given a bin of finished shots cut them in
 * bin order (Kendall tau -0.14 against the editor's) and never opened a skill.
 */
const ORDER = "Shots to re-edit: sequence_shots_tool first.";

export const DIRECTOR_CARD: string = [
  `Whole videos (reel, ad, promo, montage, a remake): ${PRODUCE} By hand: ${STYLE}`,
  SCENES,
  ORDER,
  FINISH,
  "TTS captions: kinetic_captions_tool timeline_clip_ids=[the TTS clip].",
].join("\n");

/** The scene films, in full where the start note has room: what produce_video_tool does with a cinetic style and what the agent does next. */
const SCENES_START =
  'Cinetic styles (launch teaser, feature loop, logo sting, UI walkthrough) and motion design with no footage are ONE scene, never blocks, titles or 3D: produce_video_tool {"request", "style": "cinetic-teaser"} drafts it from a worked example; get_technique_tool zenvi-scenes (the method) and scenes-launch-teaser / scenes-feature-loop / scenes-logo-sting (whole code), then update_scene_tool with this product\'s story.';

/** The one-call builders: a whole first cut in one undo step, then the recipe's fixes and the finish. */
const BUILDERS =
  "A whole first cut in one call (one undo step, every decision in its receipt), then fix single shots and finish: build_reel_tool (cut to music), build_trailer_tool (movie or game trailer), " +
  "build_explainer_tool (voice-over explainer, documentary, video essay), build_talking_head_tool (someone talking to camera), build_product_launch_tool (product launch, SaaS or app promo).";

/** Best of three (the skill's "Best of three"): only here, the card is at its budget. */
const BEST_OF =
  "60 s or shorter and watching works: make the base and two variants that differ on one axis of the brief (pacing, type, grade or music) with fork_project_tool, render 540 px proxies, pick_best_variant_tool from the base, then fix the winner's 3 fixes.";

/** open_project_file's note on an empty project: the plan, where every agent reads (its first receipt). */
export const DIRECTOR_START: string = `A new edit: ${PRODUCE} By hand instead: ${STYLE} ${BRIEF} ${BUILDERS} ${SCENES_START} ${ORDER} ${FINISH} ${BEST_OF}`;
