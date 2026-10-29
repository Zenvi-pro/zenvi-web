/**
 * The director card: the zenvi-motion-director skill
 * (plugins/zenvi/skills/zenvi-motion-director) cut to what an agent must not
 * miss, for the MCP servers' `instructions` (sent at initialize, so every
 * client sees it whether or not it loads a skill). Bench round 5: agents that
 * never opened the recipe left grade and sound to chance. It must stay under
 * 400 tokens: 366 on Claude Sonnet 5.5 at 926 characters (Bedrock
 * converse usage, 2026-10-28), so the CLI's test bounds it at 1000
 * characters; the brief step took the recipe hints' place (895), and the
 * ORDER line, watch_render_tool and data-explainer bring it to 995. The
 * recipes keep the craft. DIRECTOR_CARD and DIRECTOR_START go
 * out only from the CLI's `zenvi mcp`, where render_video and
 * read_director_recipe exist; FINISH_HINT is in engine tool descriptions on
 * every surface, so it names Zenvi Cloud's render_project too.
 */

/** The finish, for the descriptions of the tools that start a whole video (on every surface: Zenvi Cloud renders with render_project). */
export const FINISH_HINT =
  "Then finish, in order, skipping what its receipt says it did: unify_grade_tool, apply_motion_transitions_tool, spot_sound_tool and auto_sound_design_tool, master_audio_tool iterate=true, render (render_video; Zenvi Cloud: render_project), review_render_tool, watch_render_tool once (fix its HIGH issues, render, watch again at most once).";

/** The genre router: which recipe to read (the styles index has a line on each). */
const RECIPES =
  "Recipes: match-cut-montage, flash-montage, hype-reel (sport, trailer: build_reel_tool hype), documentary (voice-over), kinetic-captions (talking head), " +
  "saas-ui-promo, 3d-product-ad, editorial-type, grid-montage, data-explainer, tutorial, showreel-intro.";

/** Step 0 (plugins/zenvi/skills/zenvi-styles/BRIEF.md): the brief picks the style and the recipe. */
const BRIEF = 'First the brief: get_brief_tool; if none, inspect_media_bin_tool, read_director_recipe {styles: "brief"} and follow it, save_brief_tool.';

/** The finish every recipe ends with, in order. */
const FINISH =
  "Finish, in order: unify_grade_tool; apply_motion_transitions_tool (no track = every scene change; match cuts stay hard); spot_sound_tool, auto_sound_design_tool (genre, beats); " +
  "master_audio_tool iterate=true, last; render_video; review_render_tool; watch_render_tool once, fix its HIGH issues. Make the calls receipts say are missing.";

/**
 * Re-edit bench (2026-10-28): agents given a bin of finished shots cut them in
 * bin order (Kendall tau -0.14 against the editor's) and never opened a skill.
 */
const ORDER = "Given shots to re-edit: sequence_shots_tool first.";

export const DIRECTOR_CARD: string = [
  `Whole videos (reel, ad, promo, montage, a reference to recreate): ${BRIEF} Then read its style's recipe, read_director_recipe {recipe}. ${RECIPES}`,
  ORDER,
  FINISH,
  "TTS captions: kinetic_captions_tool timeline_clip_ids=[the TTS clip] uses its word timings.",
].join("\n");

/** open_project_file's note on an empty project: the plan, where every agent reads (its first receipt). */
/** Best of three (the skill's "Best of three"): only here, the card is at its budget. */
const BEST_OF =
  "60 s or shorter and watching works: make the base and two variants that differ on one axis of the brief (pacing, type, grade or music) with fork_project_tool, render 540 px proxies, pick_best_variant_tool from the base, then fix the winner's 3 fixes.";

export const DIRECTOR_START: string = `A new edit: ${BRIEF} Then read its style's recipe, read_director_recipe {recipe}. ${RECIPES} ${ORDER} ${FINISH} ${BEST_OF}`;
