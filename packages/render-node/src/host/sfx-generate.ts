/**
 * `AudioHost.generateSfx` on local disk: ElevenLabs Sound Effects
 * (LIBRARIES.md §3.1 and §5.3), the generator for cues Zenvi's recorded kit
 * lacks. Only with ELEVENLABS_API_KEY in the environment, and only on a
 * paid plan: ElevenLabs' free tier is for non-commercial use (terms 1(c)),
 * paid plans keep the rights in the output (4(c)(ii)). The plan is asked
 * once per process; a key that may not read it needs ELEVENLABS_PAID_PLAN=1.
 *
 * Every request is cached by sha256(provider, model, format, prompt,
 * duration, influence, loop) in `<cache>/sfx-gen/<key>.mp3`, with a
 * provenance JSON beside it (request, model, plan, cost, terms, date), and
 * never paid for twice. The key is read from the environment, never
 * written or logged.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sfxGenerationKeyText, type GeneratedSfx, type SfxGenerationRequest } from "@zenvi/engine";

const API = "https://api.elevenlabs.io/v1";
const MODEL = "eleven_text_to_sound_v2";
const FORMAT = "mp3_44100_128";
const TERMS = "https://elevenlabs.io/terms-of-use";
const LICENCE = "Generated with ElevenLabs Sound Effects on a paid plan: the output is yours to use commercially, non-exclusive (others may get similar output).";
/** 40 credits a second with the length set (ElevenLabs capabilities page); dollars per credit on the Creator plan. */
const CREDITS_PER_SECOND = 40;
const USD_PER_CREDIT = 22 / 121_000;
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export interface SfxGeneratorOptions {
  env?: NodeJS.ProcessEnv;
  /** Zenvi's cache folder; generated sounds live in its `sfx-gen` folder. */
  cacheRoot: string;
  fetchImpl?: typeof fetch;
}

export type SfxGenerator = (request: SfxGenerationRequest, options?: { signal?: AbortSignal }) => Promise<GeneratedSfx>;

/** The generator, or undefined when no provider is configured (generate_sfx_tool then says how to set one up). */
export function createSfxGenerator(options: SfxGeneratorOptions): SfxGenerator | undefined {
  const env = options.env ?? process.env;
  const key = env.ELEVENLABS_API_KEY?.trim();
  if (!key) return undefined;
  const doFetch = options.fetchImpl ?? fetch;
  const dir = path.join(options.cacheRoot, "sfx-gen");
  let plan: Promise<string> | undefined;

  /** The plan's tier; rejects on the free tier or when it cannot be known. */
  const paidPlan = (signal: AbortSignal): Promise<string> =>
    (plan ??= (async () => {
      const response = await doFetch(`${API}/user/subscription`, { headers: { "xi-api-key": key }, signal });
      if (response.ok) {
        const tier = String(((await response.json()) as { tier?: unknown }).tier ?? "");
        if (!tier || tier === "free") throw new Error("the ElevenLabs key is on the free plan, whose sounds are for non-commercial use only (ElevenLabs terms 1(c)); use a key on a paid plan.");
        return tier;
      }
      if ((response.status === 401 || response.status === 403) && env.ELEVENLABS_PAID_PLAN === "1") return "paid (stated)";
      throw new Error(`ElevenLabs did not say which plan the key is on (${response.status}); a key without user access needs ELEVENLABS_PAID_PLAN=1 once you have checked it is a paid plan.`);
    })().catch((error: unknown) => {
      plan = undefined;
      throw error;
    }));

  return async (request, opts = {}) => {
    const keyText = sfxGenerationKeyText("elevenlabs", MODEL, FORMAT, request);
    const hash = createHash("sha256").update(keyText).digest("hex");
    const file = path.join(dir, `${hash}.mp3`);
    const result = (cached: boolean, costUsd?: number): GeneratedSfx => ({ path: file, provider: "elevenlabs", model: MODEL, key: hash, cached, ...(costUsd !== undefined ? { costUsd } : {}), licence: LICENCE, termsUrl: TERMS });
    const have = await readFile(file).catch(() => undefined);
    if (have && have.length > 0) return result(true);

    const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
    const tier = await paidPlan(signal);
    let response: Response;
    try {
      response = await doFetch(`${API}/sound-generation?output_format=${FORMAT}`, {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: request.prompt.trim(), duration_seconds: request.durationSeconds, prompt_influence: request.promptInfluence, loop: request.loop, model_id: MODEL }),
        signal,
      });
    } catch (error) {
      throw new Error(`could not reach ElevenLabs (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
      throw new Error(`ElevenLabs refused the sound (${response.status}${detail ? `: ${detail}` : ""}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error(`ElevenLabs sent ${bytes.length} bytes, not a sound effect.`);
    const credits = Number(response.headers.get("character-cost")) || CREDITS_PER_SECOND * request.durationSeconds;
    const costUsd = Math.round(credits * USD_PER_CREDIT * 10000) / 10000;
    await mkdir(dir, { recursive: true });
    const provenance = { provider: "elevenlabs", model: MODEL, format: FORMAT, request, plan: tier, credits, cost_usd: costUsd, licence: LICENCE, terms_url: TERMS, made_at: new Date().toISOString(), request_id: response.headers.get("request-id") ?? undefined };
    // Written beside, then renamed: another process reading the cache never sees half a file.
    const temp = `${file}.${process.pid}.${Date.now()}.part`;
    try {
      await writeFile(temp, bytes);
      await writeFile(path.join(dir, `${hash}.json`), JSON.stringify(provenance, null, 2));
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
    return result(false, costUsd);
  };
}
