/**
 * Project version stamps (`project.version`) and the comparisons the desktop
 * load migrations make on them (zenvi-core src/classes/project_data.py
 * `upgrade_project_data_structures`, `_numeric_version`).
 */

/**
 * What the engine stamps on every project it parses or serializes: the
 * desktop build whose project semantics the engine implements
 * (zenvi-core src/classes/info.py `VERSION`) and the libopenshot release
 * whose math it ports (`MINIMUM_LIBOPENSHOT_VERSION`).
 *
 * The desktop keys its load migrations off these two strings, so a project
 * the engine wrote must never carry the `_default.project` stamp "0.0.0":
 * the desktop would flip every clip's alpha (OpenShot beta migration) and
 * re-run the libopenshot < 1.0 location migration.
 */
export const PROJECT_FORMAT_VERSION: Readonly<{ "openshot-qt": string; libopenshot: string }> = Object.freeze({
  "openshot-qt": "1.0.188",
  libopenshot: "1.0.0",
});

/** The `_default.project` stamp: an OpenShot 2.0 beta project to the desktop. */
export const BETA_VERSION = "0.0.0";

export type NumericVersion = readonly [number, number, number];

/**
 * project_data.py `_numeric_version`: the first three runs of digits in the
 * string, zero-padded ("2.1.0-dev" → [2, 1, 0], "None" → [0, 0, 0]).
 */
export function numericVersion(value: unknown): NumericVersion {
  const numbers = (String(value).match(/\d+/g) ?? []).slice(0, 3).map((part) => Number.parseInt(part, 10));
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
}

/** Tuple comparison of two numeric versions: negative, zero or positive. */
export function compareVersions(a: NumericVersion, b: NumericVersion): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return 0;
}

/**
 * True for a stamp written by a Zenvi build (desktop 1.0.x, or this engine)
 * rather than by OpenShot. OpenShot's JSON project format starts at 2.0
 * (1.x saved pickles), so any other stamp below 2 that is not the beta
 * "0.0.0" is Zenvi's own numbering.
 */
export function isZenviVersion(openshotQt: string): boolean {
  return openshotQt !== BETA_VERSION && numericVersion(openshotQt)[0] < 2;
}
