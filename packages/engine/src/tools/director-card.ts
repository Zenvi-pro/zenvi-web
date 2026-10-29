/**
 * The director card: the zenvi-motion-director skill
 * (plugins/zenvi/skills/zenvi-motion-director) cut to what an agent must not
 * miss, for the MCP servers' `instructions` (sent at initialize, so every
 * client sees it whether or not it loads a skill). Bench round 5: agents that
 * never opened the recipe left grade and sound to chance. It must stay under
 * 400 tokens: 366 on Claude Sonnet 5.5 as written, 926 characters (Bedrock
 * converse usage, 2026-10-28), so the CLI's test bounds it at 1000
 * characters. The recipes keep the craft. DIRECTOR_CARD and DIRECTOR_START go
 * out only from the CLI's `zenvi mcp`, where render_video and
 * read_director_recipe exist; FINISH_HINT is in engine tool descriptions on
 * every surface, so it names Zenvi Cloud's render_project too.
 */

/** The finish, for the descriptions of the tools that start a whole video (on every surface: Zenvi Cloud renders with render_project). */
export const FINISH_HINT =
  "Then finish, in order, skipping what its receipt says it did: unify_grade_tool, apply_motion_transitions_tool, spot_sound_tool and auto_sound_design_tool, master_audio_tool iterate=true, render (render_video; Zenvi Cloud: render_project), review_render_tool.";

/** The genre router: which recipe to read. */
const RECIPES =
  "Recipes: match-cut-montage (shapes line up), flash-montage (a new image every few frames), hype-reel (build_reel_tool hype; trailer: build_trailer_tool), documentary (voice-over: build_explainer_tool), kinetic-captions (talking head: build_talking_head_tool), " +
  "saas-ui-promo and 3d-product-ad (launch: build_product_launch_tool), editorial-type, grid-montage, tutorial, showreel-intro.";

/** The finish every recipe ends with, in order. */
const FINISH =
  "Finish every edit, in order: unify_grade_tool; apply_motion_transitions_tool (no track = every scene change; match cuts stay hard); spot_sound_tool, auto_sound_design_tool (genre, beats); " +
  "master_audio_tool iterate=true, last; render_video; review_render_tool. Receipts name what is still missing: make those calls.";

export const DIRECTOR_CARD: string = [
  `Whole videos (reel, ad, promo, montage, a reference to recreate): before the first edit read the genre's recipe with read_director_recipe {recipe} (or the zenvi-motion-director skill's recipes/). ${RECIPES}`,
  FINISH,
  "Captions on a TTS voice: kinetic_captions_tool timeline_clip_ids=[the TTS clip] uses its word timings.",
].join("\n");

/** The one-call builders: a whole first cut in one undo step, then the recipe's fixes and the finish. */
const BUILDERS =
  "A whole first cut in one call (one undo step, every decision in its receipt), then fix single shots and finish: build_reel_tool (cut to music), build_trailer_tool (movie or game trailer), " +
  "build_explainer_tool (voice-over explainer, documentary, video essay), build_talking_head_tool (someone talking to camera), build_product_launch_tool (product launch, SaaS or app promo).";

/** open_project_file's note on an empty project: the plan, where every agent reads (its first receipt). */
export const DIRECTOR_START: string = `A new edit: read the genre's recipe first, read_director_recipe {recipe}. ${RECIPES} ${BUILDERS} ${FINISH}`;
