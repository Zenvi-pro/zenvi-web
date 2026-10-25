// Motion templates: the public part other packages use (the cloud's create_reel, the editor).
export { MOTION_STYLE_IDS, MOTION_STYLES, isMotionStyleId, type MotionStyle, type MotionStyleId } from "./styles.js";
export { MOTION_TEMPLATE_IDS, isMotionTemplateId, type MotionContent, type MotionTemplateId } from "./template.js";
export { PALETTE_IDS, type MotionLayer, type MotionPlan, type PaletteId } from "./types.js";
export { buildMotionTemplate, type BuildTemplateInput } from "./build.js";
