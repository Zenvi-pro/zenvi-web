/**
 * Text-level repairs the desktop runs before parsing a project file
 * (zenvi-core src/classes/json_data.py `read_from_file`, L63-74 and L167-199).
 *
 * - OpenShot 2.6.0 could write Windows drive letters as unquoted keys.
 * - OpenShot 2.5.0 could write `\uXXXX` escapes with a forward slash
 *   (`/uXXXX`), sometimes after a lost slash in a relative path.
 *
 * Each repair only runs when the file carries the matching version stamp, so
 * healthy projects are never touched.
 */

const VERSION_250 = /"openshot-qt".*"2.5.0/;
const VERSION_260 = /"openshot-qt".*"2.6.0/;
const DAMAGE = /\/u([0-9a-fA-F]{4})/g;
// Python's `\w` matches Unicode letters and digits.
const DAMAGE_WINDOWS_DRIVES = /(\n\s*)([\p{L}\p{N}_]*):/gu;
const SLASH_REPAIR = /(["/][.]+)(\/u[0-9a-fA-F]{4})/g;

/** Repair known OpenShot 2.5.0 / 2.6.0 corruption in project text. Healthy text is returned unchanged. */
export function repairProjectText(text: string): string {
  let contents = text;
  DAMAGE_WINDOWS_DRIVES.lastIndex = 0;
  if (DAMAGE_WINDOWS_DRIVES.test(contents) && VERSION_260.test(contents)) {
    contents = contents.replace(DAMAGE_WINDOWS_DRIVES, '$1"$2":');
  }
  DAMAGE.lastIndex = 0;
  if (DAMAGE.test(contents) && VERSION_250.test(contents)) {
    contents = contents.replace(SLASH_REPAIR, "$1/$2");
    contents = contents.replace(DAMAGE, "\\u$1");
  }
  return contents;
}

/**
 * Python's `json.dumps` writes `NaN`, `Infinity` and `-Infinity` as bare
 * tokens, which `JSON.parse` rejects. Replace them (outside strings) with
 * `null` so the file can be read and the schema can name the bad field.
 * Returns `null` when the text has no such tokens.
 */
export function replaceNonFiniteTokens(text: string): string | null {
  let out = "";
  let changed = false;
  let i = 0;
  let last = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      // Skip a string literal, honoring escapes.
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    let token: string | null = null;
    if (text.startsWith("NaN", i)) token = "NaN";
    else if (text.startsWith("-Infinity", i)) token = "-Infinity";
    else if (text.startsWith("Infinity", i)) token = "Infinity";
    if (token) {
      out += text.slice(last, i) + "null";
      i += token.length;
      last = i;
      changed = true;
      continue;
    }
    i += 1;
  }
  return changed ? out + text.slice(last) : null;
}
