// Test-only: a brief that passes the motif method (brief/method.ts).

/** The motif-method part of a brief that passes save_brief_tool's rules. */
export const METHOD = {
  motifs: ["lugged sole", "mud spray", "laces", "contour lines", "altitude readout", "pace screen", "root texture", "the stride"],
  through_line: "lugged sole",
  storyboard: [
    { start: 0, beats: 4, picture: "sole hits mud", motif: "lugged sole", source: "media", file_id: "RUNXXXXXXX", composition: "full bleed", text_entrance: "none", tone: "dark earth" },
    { start: 2, beats: 2, picture: "contours draw on", motif: "contour lines", source: "motion", composition: "split", text_entrance: "typed", tone: "bright paper" },
    { start: 3, beats: 1, picture: "laces yanked", motif: "laces", source: "stock", composition: "diagonal", text_entrance: "slam", tone: "dark, orange" },
    { start: 4, beats: 8, picture: "altitude counts up", motif: "altitude readout", source: "motion", composition: "type cropped", text_entrance: "built from the motif", tone: "orange fill", climax: true },
    { start: 5, beats: 2, picture: "the sole, held", motif: "lugged sole", source: "media", file_id: "RUNXXXXXXX", composition: "centred", text_entrance: "mask wipe", tone: "dark, orange" },
  ],
  reskin: { generic: 1 },
  direction: [
    { axis: "art style", pick: "blueprint line drawing", why: "trail maps" },
    { axis: "rhythm", pick: "slow start, fast finish", why: "the climb" },
    { axis: "opening", pick: "straight into the hit", why: "the strike is the hook" },
  ],
};
