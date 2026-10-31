/**
 * Generated videos come back as URLs on the AI providers' CDNs (Grok:
 * vidgen.x.ai), which send no CORS headers, so the browser cannot fetch them
 * itself. They download through the backend's `/generation/download`
 * (zenvi-backend api/routes/generation.py, same domain list), signed in.
 */
import { getAccessToken } from "./auth";
import { config } from "./env";

const GENERATED_MEDIA_DOMAINS = ["x.ai", "runware.ai"];

export function isGeneratedMediaUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && GENERATED_MEDIA_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Where the browser downloads a generated media URL from. */
export function generatedMediaDownloadUrl(url: string, restBase: string = config.backendRestBase): string {
  return `${restBase}/generation/download?url=${encodeURIComponent(url)}`;
}

/** `fetch` with the session's token, for the backend's download route. */
export function withBackendAuth(token: () => Promise<string | null> = getAccessToken, doFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    // downloadFile's headers are a plain record (its Range); jsdom's Headers would drop Range.
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
    const value = await token();
    // A cancel during the token lookup stops here, before the request.
    init?.signal?.throwIfAborted();
    if (value) headers.Authorization = `Bearer ${value}`;
    return doFetch(input, { ...init, headers });
  };
}
