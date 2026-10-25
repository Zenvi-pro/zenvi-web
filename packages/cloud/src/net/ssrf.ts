/**
 * SSRF policy for server-side fetches (media imports from URLs, OAuth client
 * metadata documents). A URL is fetched only when:
 *
 *   - it is https (tests may allow http), with no credentials and the default port;
 *   - its host is a public DNS name or a public IP literal;
 *   - EVERY address the name resolves to is public unicast — no loopback,
 *     private, link-local (Azure IMDS 169.254.169.254), CGNAT, multicast,
 *     reserved, documentation, NAT64/6to4/Teredo, or the Azure platform
 *     address 168.63.129.16;
 *   - the connection goes to an address we checked (the checked address is
 *     pinned through `lookup`, so DNS rebinding cannot swap it afterwards).
 *
 * Redirects are followed by the caller one hop at a time, re-checking each.
 */

import { isIP } from "node:net";
import { isPublicAddress } from "@zenvi/render-node";

export { isPublicAddress };

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

export interface UrlPolicy {
  protocols: ReadonlyArray<"https:" | "http:">;
  /** Address filter; production uses `isPublicAddress`. */
  isAllowedAddress: (ip: string) => boolean;
  /** Allow non-default ports (tests only). */
  allowAnyPort?: boolean;
}

export const PUBLIC_HTTPS: UrlPolicy = { protocols: ["https:"], isAllowedAddress: isPublicAddress };

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet"];

/** Parse and check a URL against the policy (before any DNS). Throws SsrfError. */
export function checkUrl(raw: string, policy: UrlPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("Not a valid URL.");
  }
  if (!policy.protocols.includes(url.protocol as "https:" | "http:")) {
    throw new SsrfError(`Only ${policy.protocols.map((p) => p.replace(":", "")).join("/")} URLs are allowed.`);
  }
  if (url.username || url.password) throw new SsrfError("URLs with credentials are not allowed.");
  if (url.port !== "" && !policy.allowAnyPort) throw new SsrfError("URLs must use the default port.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "") throw new SsrfError("The URL has no host.");
  if (isIP(host)) {
    if (!policy.isAllowedAddress(host)) throw new SsrfError("That address is not reachable from Zenvi Cloud.");
    return url;
  }
  if (!policy.allowAnyPort) {
    if (host === "localhost" || !host.includes(".") || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new SsrfError("That host is not reachable from Zenvi Cloud.");
    }
  }
  return url;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** Resolve and check every address; returns the allowed ones (all of them, or throws). */
export async function resolveChecked(hostname: string, resolver: Resolver, policy: UrlPolicy): Promise<ResolvedAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  const addresses: ResolvedAddress[] = literal ? [{ address: host, family: literal as 4 | 6 }] : await resolver(host);
  if (addresses.length === 0) throw new SsrfError(`Could not resolve ${host}.`);
  for (const { address } of addresses) {
    if (!policy.isAllowedAddress(address)) throw new SsrfError("That host resolves to an address Zenvi Cloud does not connect to.");
  }
  return addresses;
}
