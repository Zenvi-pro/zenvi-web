/**
 * Where a project file's bytes live in the browser, and how to read them.
 */

import { BlobSource, UrlSource, type Source } from "mediabunny";

/** A readable media location. */
export type MediaSourceSpec =
  /** A `File` or `Blob` in memory (picked, dropped, generated). */
  | { kind: "blob"; blob: Blob; name?: string }
  /** A file in the origin private file system; read lazily. */
  | { kind: "opfs"; handle: FileSystemFileHandle }
  /**
   * An HTTP(S) URL, typically a short-lived signed URL. When the server answers
   * 401/403 (expired signature) `refresh` is called once for a new URL and the
   * request is retried. Media is read with range requests.
   */
  | {
      kind: "url";
      url: string;
      name?: string;
      refresh?: () => Promise<string>;
      requestInit?: Omit<RequestInit, "signal">;
      /** Custom fetch (tests, auth). Defaults to the global `fetch`. */
      fetch?: typeof fetch;
    };

/** File name used for extension-based decisions (audio-only, image, SVG). */
export function sourceName(spec: MediaSourceSpec): string {
  switch (spec.kind) {
    case "blob":
      return spec.name ?? (spec.blob instanceof File ? spec.blob.name : "");
    case "opfs":
      return spec.handle.name;
    case "url": {
      if (spec.name) return spec.name;
      try {
        const path = new URL(spec.url, "http://local/").pathname;
        return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
      } catch {
        return "";
      }
    }
  }
}

/** A fetch that substitutes the current signed URL and refreshes it once on 401/403. */
export interface RefreshingFetch {
  fetch: typeof fetch;
  currentUrl(): string;
}

export function createRefreshingFetch(
  initialUrl: string,
  refresh?: () => Promise<string>,
  baseFetch: typeof fetch = (input, init) => fetch(input, init),
): RefreshingFetch {
  let url = initialUrl;
  // Concurrent range requests that all see an expired signature share one refresh.
  let refreshing: Promise<string> | null = null;
  const renew = (stale: string): Promise<string> => {
    if (url !== stale) return Promise.resolve(url);
    if (!refreshing) {
      refreshing = refresh!()
        .then((next) => {
          url = next;
          return next;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  };
  const wrapped: typeof fetch = async (_input, init) => {
    const requested = url;
    const response = await baseFetch(requested, init);
    if (!refresh || (response.status !== 401 && response.status !== 403)) return response;
    await response.body?.cancel().catch(() => undefined);
    const next = await renew(requested);
    return baseFetch(next, init);
  };
  return { fetch: wrapped, currentUrl: () => url };
}

/** A Mediabunny `Source` for demuxing. */
export async function openSource(spec: MediaSourceSpec): Promise<Source> {
  switch (spec.kind) {
    case "blob":
      return new BlobSource(spec.blob);
    case "opfs":
      return new BlobSource(await spec.handle.getFile());
    case "url": {
      const refreshing = createRefreshingFetch(spec.url, spec.refresh, spec.fetch);
      return new UrlSource(spec.url, {
        fetchFn: refreshing.fetch,
        ...(spec.requestInit ? { requestInit: spec.requestInit } : {}),
      });
    }
  }
}

/** The whole content as a Blob (stills, SVG). */
export async function readBlob(spec: MediaSourceSpec, signal?: AbortSignal): Promise<Blob> {
  switch (spec.kind) {
    case "blob":
      return spec.blob;
    case "opfs":
      return spec.handle.getFile();
    case "url": {
      const refreshing = createRefreshingFetch(spec.url, spec.refresh, spec.fetch);
      const response = await refreshing.fetch(spec.url, { ...spec.requestInit, ...(signal ? { signal } : {}) });
      if (!response.ok) throw new Error(`Could not read ${sourceName(spec) || "media"}: HTTP ${response.status}`);
      return response.blob();
    }
  }
}

/** Byte size, when cheap to know. */
export async function sourceSize(spec: MediaSourceSpec): Promise<number | null> {
  switch (spec.kind) {
    case "blob":
      return spec.blob.size;
    case "opfs":
      return (await spec.handle.getFile()).size;
    case "url":
      return null;
  }
}
