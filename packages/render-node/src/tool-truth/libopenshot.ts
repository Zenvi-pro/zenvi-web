/**
 * The desktop's renderer as an oracle: libopenshot's own Timeline loads the
 * project JSON the engine wrote, reports the property values it evaluated
 * (Clip/EffectBase::PropertiesJSON, libopenshot/src/Clip.cpp and
 * EffectBase.cpp) and renders the frame (Timeline::GetFrame) or the mix.
 * A key libopenshot does not know is absent from PropertiesJSON, and a
 * keyframe shape it cannot parse evaluates to the default, so "the value
 * moved there too" proves the JSON matches what the desktop reads.
 *
 * Maintainer machines only (the bindings of zenvi-deps); undefined elsewhere.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Project, RgbaImage } from "@zenvi/engine";
import { decodeRgba, removeDir } from "../test-support/fixtures.js";
import { RENDER_WIDTH } from "./fixtures.js";

const exec = promisify(execFile);

export interface OracleRender {
  error?: string;
  /** `<clip id>.<key>` and `<effect id>.<key>` → evaluated value at the frame. */
  properties?: Record<string, unknown>;
  image?: RgbaImage;
  /** Per-channel RMS (dBFS) and brightness of the whole mix. */
  sound?: Record<string, number>;
}

const SCRIPT = String.raw`
import json, math, os, sys
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PyQt5.QtWidgets import QApplication
app = QApplication([])  # libopenshot's text effects (Caption, Timer) paint with Qt
import openshot
jobs = json.load(open(sys.argv[1]))
out = []
for job in jobs:
    try:
        with open(job["project"]) as f:
            project = json.load(f)
        t = openshot.Timeline(project["width"], project["height"], openshot.Fraction(project["fps"]["num"], project["fps"]["den"]),
                              project["sample_rate"], project["channels"], project["channel_layout"])
        t.SetJson(json.dumps(project))
        t.Open()
        frame = job["frame"]
        props = {}
        for clip in t.Clips():
            for k, v in json.loads(clip.PropertiesJSON(frame)).items():
                props[clip.Id() + "." + k] = v.get("value") if isinstance(v, dict) else v
            for i, e in enumerate(clip.Effects()):
                # Effect ids are generated per run: key by the clip and the effect's place and class.
                name = "%s.%d.%s" % (clip.Id(), i, json.loads(e.Json()).get("class_name"))
                for k, v in json.loads(e.PropertiesJSON(frame)).items():
                    if k != "id":
                        props[name + "." + k] = v.get("value") if isinstance(v, dict) else v
        result = {"properties": props}
        if job["picture"]:
            t.GetFrame(frame).Save(job["png"], 1.0)
        if job["sound"]:
            end = max([c.Position() + c.Duration() for c in t.Clips()] + [0])
            frames = int(math.ceil(end * project["fps"]["num"] / project["fps"]["den"]))
            sums, mono, prev, diff, count = [0.0, 0.0], 0.0, 0.0, 0.0, 0
            for n in range(1, frames + 1):
                fr = t.GetFrame(n)
                ch = fr.GetAudioChannelsCount()
                for i in range(fr.GetAudioSamplesCount()):
                    l = fr.GetAudioSample(0, i, 1)
                    r = fr.GetAudioSample(1, i, 1) if ch > 1 else l
                    sums[0] += l * l
                    sums[1] += r * r
                    m = (l + r) / 2
                    mono += m * m
                    diff += (m - prev) ** 2
                    prev = m
                    count += 1
            db = lambda s: 20 * math.log10(max(math.sqrt(s / max(1, count)), 1e-6))
            result["sound"] = {"rms_left": db(sums[0]), "rms_right": db(sums[1]), "rms": db(mono),
                               "brightness": math.sqrt(diff / max(1, count)) / max(math.sqrt(mono / max(1, count)), 1e-9)}
        t.Close()
        out.append(result)
    except Exception as e:
        out.append({"error": str(e)})
print(json.dumps(out))
`;

function bindings(): { python: string; env: NodeJS.ProcessEnv } | undefined {
  const home = homedir();
  const python = process.env.ZENVI_LIBOPENSHOT_PYTHON ?? path.join(home, "Projects", "zenvi", ".venv", "bin", "python");
  const deps = process.env.ZENVI_LIBOPENSHOT_DEPS ?? path.join(home, "zenvi-deps-1.0");
  if (!existsSync(python) || !existsSync(path.join(deps, "python"))) return undefined;
  return { python, env: { ...process.env, PYTHONPATH: path.join(deps, "python"), DYLD_LIBRARY_PATH: path.join(deps, "lib") } };
}

export function libopenshotAvailable(): boolean {
  return bindings() !== undefined;
}

/** Load (and render) each project in libopenshot; undefined without the bindings. */
export async function libopenshotOracle(
  projects: readonly Project[],
  options: { frame: number; picture: boolean; sound: boolean },
): Promise<OracleRender[] | undefined> {
  const py = bindings();
  if (!py) return undefined;
  const dir = await mkdtemp(path.join(tmpdir(), "zenvi-tool-truth-oracle-"));
  try {
    const jobs = await Promise.all(
      projects.map(async (project, i) => {
        const file = path.join(dir, `p${i}.json`);
        await writeFile(file, JSON.stringify(project));
        return { project: file, frame: options.frame, picture: options.picture, sound: options.sound, png: path.join(dir, `p${i}.png`) };
      }),
    );
    const jobsFile = path.join(dir, "jobs.json");
    await writeFile(jobsFile, JSON.stringify(jobs));
    const { stdout } = await exec(py.python, ["-c", SCRIPT, jobsFile], { env: py.env, maxBuffer: 64 * 1024 * 1024 });
    const raw = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "[]") as OracleRender[];
    return await Promise.all(
      raw.map(async (r, i) => {
        if (r.error || !options.picture) return r;
        const p = projects[i]!;
        const height = Math.round((RENDER_WIDTH * p.height) / p.width);
        const data = await decodeRgba(jobs[i]!.png, { width: RENDER_WIDTH, height });
        return { ...r, image: { width: RENDER_WIDTH, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) } };
      }),
    );
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const message = stderr ? stderr.slice(-400) : error instanceof Error ? error.message.slice(0, 400) : String(error);
    return projects.map(() => ({ error: message }));
  } finally {
    await removeDir(dir);
  }
}
