/**
 * Curate the recorded SFX kit (engine sfx/recorded.ts) from Freesound's CC0
 * sounds, in three steps whose files stay out of the repo:
 *
 *   FREESOUND_API_KEY=... npx tsx curate-kit.ts search <work-dir>    queries.json -> candidates.json
 *   npx tsx curate-kit.ts measure <work-dir>                          previews -> measured.json
 *   npx tsx curate-kit.ts select <work-dir> [listen.json] [--heard]   -> curated.json
 *
 * then `gen-recorded-kit.ts <work-dir>/curated.json` writes the manifest.
 *
 * search keeps CC0 originals of 44.1 kHz or more, lossless, not tagged as
 * synthesised, music, voice or a rip. measure downloads every candidate's
 * HQ preview (cdn.freesound.org, no key) and measures it with the engine's
 * own analysis (sfx/analyse.ts), rejecting noisy, clipped, band-limited or
 * badly trimmed sounds. select ranks what is left by ratings, downloads and
 * measurement, keeps at most three sounds per uploader in a group, drops
 * what the listening pass (listen.json: id -> {ok, note}) refused, and
 * keeps each group's quota; --heard keeps only sounds the pass heard and
 * passed (the last step, once listen-kit.ts has heard the refills). The API key is read from the environment and
 * never written.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyseKitSound, type KitAnalysis } from "../../src/sfx/analyse.js";
import { RECORDED_GROUPS, type RecordedGroup } from "../../src/sfx/recorded.js";
import { RECORDED_KIT } from "../../src/sfx/recorded-kit.data.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CC0 = /^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/;
const FIELDS = "id,name,tags,username,license,duration,previews,samplerate,bitdepth,channels,type,num_downloads,avg_rating,num_ratings,description,pack";
/** Words that mark a sound as synthesised, music, speech or somebody else's recording (a game, a film). */
const REJECT_WORDS = /\b(synth|synthesi[sz]ed|synthesizer|8.?bit|chiptune|bfxr|sfxr|jsfxr|retro game|arcade|music|melody|song|loop(?:ed|able)?|voice|vocal|speech|talking|movie|film|star ?wars|lightsaber|mario|zelda|sonic|pokemon|minecraft|ripped|sample pack)\b/i;
/** Groups where loops and long beds are the point. */
const LOOPING: ReadonlySet<RecordedGroup> = new Set(["ambience", "typing"]);
/** Groups whose sounds are tonal or electronic by nature (a chime, a glitch). */
const TONAL: ReadonlySet<RecordedGroup> = new Set(["sparkle", "notify", "glitch"]);
const LOSSLESS = new Set(["wav", "flac", "aiff", "aif"]);

interface GroupQuery {
  keep: number;
  /** Candidates to download and measure (default four times keep, at least 60): more where few pass. */
  measure?: number;
  seconds: [number, number];
  queries: string[];
}

interface FreesoundSound {
  id: number;
  name: string;
  tags: string[];
  username: string;
  license: string;
  duration: number;
  previews: Record<string, string>;
  samplerate: number;
  bitdepth: number;
  channels: number;
  type: string;
  num_downloads: number;
  avg_rating: number;
  num_ratings: number;
  description: string;
  pack?: string | null;
}

export interface Candidate {
  group: RecordedGroup;
  id: number;
  name: string;
  username: string;
  tags: string[];
  license_url: string;
  license_checked_at: string;
  duration: number;
  preview_url: string;
  samplerate: number;
  bitdepth: number;
  channels: number;
  type: string;
  downloads: number;
  rating: number;
  ratings: number;
  pack?: string;
  /** Already in #61's kit. */
  kept?: boolean;
}

export interface Measured extends Candidate {
  sha256: string;
  bytes: number;
  analysis: KitAnalysis;
  rejected?: string;
  score: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Why a search hit cannot be a kit sound of `group`, or undefined. */
function refusal(s: FreesoundSound, group: RecordedGroup): string | undefined {
  if (!CC0.test(s.license)) return "not CC0";
  if (!(s.samplerate >= 44100)) return `sample rate ${s.samplerate}`;
  if (!LOSSLESS.has(s.type)) return `lossy original (${s.type})`;
  if (s.bitdepth > 0 && s.bitdepth < 16) return `${s.bitdepth}-bit`;
  if (!s.previews?.["preview-hq-mp3"]?.startsWith("https://cdn.freesound.org/previews/")) return "no CDN preview";
  const words = `${s.name} ${s.tags.join(" ")}`;
  const hit = REJECT_WORDS.exec(words);
  if (hit && !(LOOPING.has(group) && /^loop/i.test(hit[1]!)) && !(TONAL.has(group) && /^(synth|melody)/i.test(hit[1]!))) return `tagged ${hit[1]}`;
  return undefined;
}

async function search(dir: string): Promise<void> {
  const key = process.env.FREESOUND_API_KEY;
  if (!key) throw new Error("search needs FREESOUND_API_KEY in the environment");
  const spec = JSON.parse(readFileSync(path.join(HERE, "queries.json"), "utf8")) as { groups: Record<string, GroupQuery> };
  const today = new Date().toISOString().slice(0, 10);
  const out = new Map<number, Candidate>();
  const refused = new Map<string, number>();
  for (const [name, q] of Object.entries(spec.groups)) {
    const group = name as RecordedGroup;
    if (!RECORDED_GROUPS.includes(group)) throw new Error(`queries.json: unknown group ${name}`);
    for (const query of q.queries) {
      const url = new URL("https://freesound.org/apiv2/search/");
      url.searchParams.set("query", query);
      url.searchParams.set("filter", `license:"Creative Commons 0" duration:[${q.seconds[0]} TO ${q.seconds[1]}]`);
      url.searchParams.set("sort", "rating_desc");
      url.searchParams.set("fields", FIELDS);
      url.searchParams.set("page_size", "150");
      url.searchParams.set("token", key);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Freesound answered ${response.status} for ${group}/${query}`);
      const page = (await response.json()) as { results: FreesoundSound[] };
      let took = 0;
      for (const s of page.results) {
        const why = refusal(s, group);
        if (why) {
          refused.set(why.replace(/\d+/g, "#"), (refused.get(why.replace(/\d+/g, "#")) ?? 0) + 1);
          continue;
        }
        if (out.has(s.id)) continue;
        out.set(s.id, {
          group,
          id: s.id,
          name: s.name.slice(0, 120),
          username: s.username,
          tags: s.tags.slice(0, 12).map((t) => t.toLowerCase()),
          license_url: s.license,
          license_checked_at: today,
          duration: s.duration,
          preview_url: s.previews["preview-hq-mp3"]!,
          samplerate: s.samplerate,
          bitdepth: s.bitdepth,
          channels: s.channels,
          type: s.type,
          downloads: s.num_downloads,
          rating: s.avg_rating,
          ratings: s.num_ratings,
          ...(s.pack ? { pack: s.pack } : {}),
        });
        took += 1;
      }
      console.log(`${group}/${query}: ${page.results.length} hits, ${took} new`);
      // Freesound allows 60 requests a minute; stay well under it.
      await sleep(1500);
    }
  }
  for (const s of RECORDED_KIT) {
    const c = out.get(s.id);
    if (c) {
      c.kept = true;
      c.group = s.group;
    }
  }
  writeFileSync(path.join(dir, "candidates.json"), JSON.stringify([...out.values()], null, 1));
  console.log(`${out.size} candidates; refused: ${JSON.stringify(Object.fromEntries(refused))}`);
}

/** Decode to planar float stereo at 48 kHz with ffmpeg (mono sources come out as two equal channels). */
function decode(file: string): Float32Array[] {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "2", "-ar", "48000", "-"], { maxBuffer: 256 * 1024 * 1024 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const n = all.length / 2;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    left[i] = all[2 * i]!;
    right[i] = all[2 * i + 1]!;
  }
  return [left, right];
}

/** Groups whose sounds end on their loudest moment, by design (a reverse cymbal stops dead). */
const ENDS_LOUD: ReadonlySet<RecordedGroup> = new Set(["riser", "reverse"]);
/** Groups that may have nothing above 10 kHz. */
const DARK: ReadonlySet<RecordedGroup> = new Set(["sub", "boom", "thud"]);

/** Why a measured sound stays out of the kit, or undefined. */
function measuredRefusal(c: Candidate, a: KitAnalysis): string | undefined {
  if (a.clippedRuns > 2) return `clipped (${a.clippedRuns} runs)`;
  if (!LOOPING.has(c.group) && a.noiseFloorDb > -45) return `noise floor ${a.noiseFloorDb.toFixed(0)} dB`;
  if (!LOOPING.has(c.group) && !ENDS_LOUD.has(c.group) && a.tailDb > -30) return `tail cut off (${a.tailDb.toFixed(0)} dB at the end)`;
  if (LOOPING.has(c.group) && a.noiseFloorDb < -40) return "drops out (not a steady bed)";
  if (a.airDb < -70 && !DARK.has(c.group)) return "nothing above 10 kHz (a low-rate source)";
  if (a.onsetMs > 600 && !LOOPING.has(c.group)) return `starts late (${Math.round(a.onsetMs)} ms of silence)`;
  if (c.group === "sub" && a.lowShare < 0.35) return `no sub (${(a.lowShare * 100).toFixed(0)} % under 150 Hz)`;
  if ((c.group === "sparkle" || c.group === "notify") && a.centroidHz < 1500) return `too dark for a ${c.group} (${Math.round(a.centroidHz)} Hz)`;
  if (ENDS_LOUD.has(c.group) && a.peakMs < 0.5 * a.endMs) return "peaks early (not a build)";
  if (!LOOPING.has(c.group) && c.group !== "riser" && (a.endMs - a.onsetMs) / 1000 > 6) return "too long";
  return undefined;
}

/** Ratings (shrunk towards 3.5 when few) and downloads: what listeners made of it. */
function popularityOf(c: Candidate): number {
  return (c.rating * c.ratings + 3.5 * 5) / (c.ratings + 5) + 0.5 * Math.log10(c.downloads + 1) + (c.kept ? 0.5 : 0);
}

/** Popularity plus a clean floor; 0..~10. */
function scoreOf(c: Candidate, a: KitAnalysis): number {
  return popularityOf(c) + Math.min(1, Math.max(0, (-a.noiseFloorDb - 45) / 30));
}

/** Candidates worth downloading: each group's most popular (queries.json `measure`). */
function shortlist(candidates: readonly Candidate[]): Candidate[] {
  const spec = JSON.parse(readFileSync(path.join(HERE, "queries.json"), "utf8")) as { groups: Record<string, GroupQuery> };
  return Object.entries(spec.groups).flatMap(([group, q]) =>
    candidates
      .filter((c) => c.group === group)
      .sort((a, b) => popularityOf(b) - popularityOf(a) || a.id - b.id)
      .slice(0, q.measure ?? Math.max(60, 4 * q.keep)),
  );
}

async function measure(dir: string): Promise<void> {
  const candidates = shortlist(JSON.parse(readFileSync(path.join(dir, "candidates.json"), "utf8")) as Candidate[]);
  const cache = path.join(dir, "previews");
  mkdirSync(cache, { recursive: true });
  const known = existsSync(path.join(dir, "measured.json")) ? new Map((JSON.parse(readFileSync(path.join(dir, "measured.json"), "utf8")) as Measured[]).map((m) => [m.id, m])) : new Map<number, Measured>();
  const out: Measured[] = [];
  let k = 0;
  const work = candidates.filter((c) => !known.has(c.id));
  // A few previews at a time from Freesound's CDN; the analysis runs between.
  for (let i = 0; i < work.length; i += 6) {
    await Promise.all(
      work.slice(i, i + 6).map(async (c) => {
        const file = path.join(cache, `${c.id}.mp3`);
        if (!existsSync(file)) {
          const response = await fetch(c.preview_url, { redirect: "error" }).catch(() => undefined);
          if (!response?.ok) return;
          writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
        }
      }),
    );
    for (const c of work.slice(i, i + 6)) {
      const file = path.join(cache, `${c.id}.mp3`);
      if (!existsSync(file)) continue;
      const bytes = readFileSync(file);
      try {
        const channels = decode(file);
        const analysis = analyseKitSound(channels, 48000);
        const rejected = measuredRefusal(c, analysis);
        known.set(c.id, { ...c, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, analysis, score: scoreOf(c, analysis), ...(rejected ? { rejected } : {}) });
      } catch (error) {
        console.log(`${c.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      k += 1;
    }
    if (i % 60 === 0) console.log(`${k}/${work.length}`);
  }
  // Refusals and scores are made again from the stored measurement, so a changed rule needs no new download.
  for (const c of candidates) {
    const m = known.get(c.id);
    if (!m) continue;
    const rejected = measuredRefusal(c, m.analysis);
    const { rejected: _old, ...rest } = m;
    out.push({ ...rest, group: c.group, kept: c.kept, score: scoreOf(c, m.analysis), ...(rejected ? { rejected } : {}) });
  }
  writeFileSync(path.join(dir, "measured.json"), JSON.stringify(out, null, 1));
  const rejected = out.filter((m) => m.rejected).length;
  console.log(`${out.length} measured, ${rejected} rejected`);
}

/** The first word or two of a name, so takes of one session ("whip01", "whip02") count as one source. */
function stemOf(name: string): string {
  return name.toLowerCase().replace(/\.(wav|flac|aiff?|ogg|mp3)$/, "").replace(/[\d_\-\s.()#]+$/g, "").slice(0, 24);
}

function select(dir: string, listenFile?: string, heardOnly = false): void {
  const measured = JSON.parse(readFileSync(path.join(dir, "measured.json"), "utf8")) as Measured[];
  const spec = JSON.parse(readFileSync(path.join(HERE, "queries.json"), "utf8")) as { groups: Record<string, GroupQuery> };
  const listen = listenFile ? (JSON.parse(readFileSync(listenFile, "utf8")) as Record<string, { ok: boolean; note?: string }>) : {};
  const curated: Measured[] = [];
  for (const [name, q] of Object.entries(spec.groups)) {
    const pool = measured.filter((m) => m.group === name && !m.rejected && (heardOnly ? listen[m.id]?.ok === true : listen[m.id]?.ok !== false)).sort((a, b) => b.score - a.score || a.id - b.id);
    const perUser = new Map<string, number>();
    const stems = new Set<string>();
    const take: Measured[] = [];
    for (const m of pool) {
      if (take.length >= q.keep) break;
      const stem = `${m.username}/${stemOf(m.name)}`;
      if ((perUser.get(m.username) ?? 0) >= 3 || (stems.has(stem) && !m.kept)) continue;
      perUser.set(m.username, (perUser.get(m.username) ?? 0) + 1);
      stems.add(stem);
      take.push(m);
    }
    console.log(`${name}: ${take.length}/${q.keep} (pool ${pool.length})`);
    curated.push(...take);
  }
  writeFileSync(path.join(dir, "curated.json"), JSON.stringify(curated, null, 1));
  console.log(`${curated.length} sounds -> curated.json`);
}

const [step, dir, extra, flag] = process.argv.slice(2);
if (!step || !dir) throw new Error("usage: curate-kit.ts search|measure|select <work-dir> [listen.json]");
mkdirSync(dir, { recursive: true });
if (step === "search") await search(dir);
else if (step === "measure") await measure(dir);
else if (step === "select") select(dir, extra, flag === "--heard");
else throw new Error(`unknown step ${step}`);
