import type { MotionTemplateId, TemplateSpec } from "../template.js";
import { gridBackground } from "./backgrounds.js";
import { callout } from "./callout.js";
import { cardCascade } from "./card-cascade.js";
import { compare } from "./compare.js";
import { cropLabels } from "./crop-labels.js";
import { endCard } from "./end-card.js";
import { kineticType } from "./kinetic-type.js";
import { montageGrid } from "./montage-grid.js";
import { passWipe } from "./pass-wipe.js";
import { reflow } from "./reflow.js";
import { stepCard } from "./step-card.js";
import { typeSearch } from "./type-search.js";
import { uiCards } from "./ui-cards.js";
import { windowCascade } from "./window-cascade.js";
import { wordScroll } from "./word-scroll.js";

/** Every template by id. */
export const TEMPLATES: Readonly<Record<MotionTemplateId, TemplateSpec>> = {
  ui_cards: uiCards,
  type_search: typeSearch,
  word_scroll: wordScroll,
  crop_labels: cropLabels,
  callout,
  kinetic_type: kineticType,
  step_card: stepCard,
  grid_background: gridBackground,
  end_card: endCard,
  grid: montageGrid,
  card_cascade: cardCascade,
  compare,
  window_cascade: windowCascade,
  pass_wipe: passWipe,
  reflow,
};
