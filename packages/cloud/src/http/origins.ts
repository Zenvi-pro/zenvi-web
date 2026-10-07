/**
 * Origin patterns (`https://*.vercel.app`, `http://localhost:*`) and the
 * public-origin choice for a request.
 */

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile patterns into one matcher. `*` in the host matches one or more DNS
 * labels' worth of characters except `/` and `:`; `:*` matches any port.
 */
export function originMatcher(patterns: readonly string[]): (origin: string) => boolean {
  const regexes = patterns.map((pattern) => {
    const trimmed = pattern.replace(/\/+$/, "");
    const source = escapeRegex(trimmed)
      .replace(/:\*$/, "(?::\\d{1,5})?")
      .replace(/\*/g, "[a-z0-9-]+(?:\\.[a-z0-9-]+)*");
    return new RegExp(`^${source}$`, "i");
  });
  return (origin: string) => regexes.some((regex) => regex.test(origin));
}

/**
 * The public origin a request arrived on: the canonical base URL, or one of
 * the configured aliases when the Host header names it. Arbitrary Host headers
 * never influence issuer or resource URLs.
 */
export function requestOrigin(
  canonical: string,
  aliases: readonly string[],
  host: string | undefined,
  forwardedProto: string | undefined,
): string {
  if (!host) return canonical;
  const proto = (forwardedProto?.split(",")[0]?.trim() || new URL(canonical).protocol.replace(":", "")).toLowerCase();
  const candidate = `${proto}://${host.toLowerCase()}`;
  for (const known of [canonical, ...aliases]) {
    if (known.toLowerCase() === candidate) return known;
  }
  return canonical;
}
