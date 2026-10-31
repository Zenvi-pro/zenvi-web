/**
 * `zenvi speech`: on-device speech recognition. `setup` says what it will
 * download and installs the speech runtime and the Whisper weights into
 * Zenvi's cache (nothing ships with the CLI); `status` shows what is there
 * and where tools transcribe; `transcribe` prints a file's words with their
 * times, for checking it by ear.
 */

import path from "node:path";
import type { Command } from "commander";
import {
  SPEECH_MODELS,
  TRANSFORMERS_INSTALL_BYTES,
  TRANSFORMERS_VERSION,
  ensureModel,
  installSpeechRuntime,
  localSpeechReady,
  resolveTransformers,
  speechMode,
  speechModelBytes,
  speechModelId,
  speechModelPresent,
  transcribeLocally,
  type SpeechModelId,
} from "@zenvi/render-node";
import { CliError } from "../output.js";
import type { CommandContext } from "./context.js";

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function modelFlag(value: string | undefined, ctx: CommandContext): SpeechModelId {
  if (value === undefined) return speechModelId(ctx.env);
  if (value === "base" || value === "small") return value;
  throw new CliError(`--model must be base or small (got ${value}).`, 2);
}

export function registerSpeechCommands(program: Command, ctx: CommandContext): void {
  const speech = program.command("speech").description("on-device speech recognition (Whisper) for transcripts, word-timed captions and lyric alignment");

  speech
    .command("setup")
    .description("download the speech runtime (about 470 MB installed) and Whisper weights (base about 80 MB, small about 255 MB) into Zenvi's cache")
    .option("--model <model>", "base (default, $ZENVI_SPEECH_MODEL) or small (hears sung and noisy speech better)")
    .action(async (flags: { model?: string }) => {
      const id = modelFlag(flags.model, ctx);
      const model = SPEECH_MODELS[id];
      const runtime = resolveTransformers(ctx.env);
      const modelReady = speechModelPresent(model, { env: ctx.env });
      if (!runtime) ctx.out.info(`Installing @huggingface/transformers ${TRANSFORMERS_VERSION} (Apache-2.0) with npm: about ${megabytes(TRANSFORMERS_INSTALL_BYTES)} on disk…`);
      const entry = runtime ?? (await installSpeechRuntime({ env: ctx.env }));
      if (!modelReady) ctx.out.info(`Downloading ${model.name} (${model.license}): ${megabytes(speechModelBytes(model))}…`);
      const weights = await ensureModel(model, { env: ctx.env, log: (m) => ctx.out.info(m) });
      if (ctx.out.json) {
        ctx.out.data({ runtime: entry, model: id, weights: path.dirname(path.dirname(weights)), license: model.license });
        return;
      }
      // Tools hear with the model ZENVI_SPEECH_MODEL selects, which may not be the one just set up.
      const selected = speechModelId(ctx.env);
      if (selected !== id && !speechModelPresent(SPEECH_MODELS[selected], { env: ctx.env })) {
        ctx.out.info(`${model.name} is downloaded. Set ZENVI_SPEECH_MODEL=${id} so tools transcribe with it (they use ${selected}, which is not downloaded).`);
        return;
      }
      ctx.out.info(`Speech recognition is ready on this machine (${SPEECH_MODELS[selected].name}). Tools now transcribe here, free and offline.`);
    });

  speech
    .command("status")
    .description("show whether speech recognition runs on this machine, and with which model")
    .action(() => {
      const id = speechModelId(ctx.env);
      const runtime = resolveTransformers(ctx.env);
      const models = (Object.keys(SPEECH_MODELS) as SpeechModelId[]).map((m) => ({ model: m, present: speechModelPresent(SPEECH_MODELS[m], { env: ctx.env }) }));
      const ready = localSpeechReady({ env: ctx.env });
      const mode = speechMode(ctx.env);
      if (ctx.out.json) {
        ctx.out.data({ ready, mode, model: id, runtime: runtime ?? null, models });
        return;
      }
      ctx.out.line(`runtime: ${runtime ?? "not installed"}`);
      for (const m of models) ctx.out.line(`model ${m.model}: ${m.present ? "downloaded" : "not downloaded"}${m.model === id ? " (selected)" : ""}`);
      ctx.out.line(
        ready && mode !== "cloud" && mode !== "off"
          ? "Tools transcribe on this machine."
          : mode === "off"
            ? "Speech recognition is off (ZENVI_SPEECH=off)."
            : mode === "local"
              ? `ZENVI_SPEECH=local, but on-device speech is not set up: run \`zenvi speech setup${id === "small" ? " --model small" : ""}\`.`
              : "Tools transcribe through the Zenvi backend when signed in (zenvi login); run `zenvi speech setup` to transcribe here instead.",
      );
    });

  speech
    .command("transcribe")
    .description("print the words of a media file with their start and end seconds (on device)")
    .argument("<file>", "audio or video file")
    .option("--language <code>", "ISO 639-1 code of the speech (default: English)")
    .option("--model <model>", "base or small")
    .action(async (file: string, flags: { language?: string; model?: string }) => {
      const id = modelFlag(flags.model, ctx);
      if (!resolveTransformers(ctx.env) || !speechModelPresent(SPEECH_MODELS[id], { env: ctx.env })) {
        throw new CliError(`On-device speech recognition is not set up: run \`zenvi speech setup${id === "small" ? " --model small" : ""}\`.`, 2);
      }
      const result = await transcribeLocally(path.resolve(ctx.cwd, file), { language: flags.language ?? "", env: ctx.env, model: id });
      if (ctx.out.json) {
        ctx.out.data(result);
        return;
      }
      ctx.out.table(
        ["start", "end", "word"],
        result.words.map((w) => [w.startSec.toFixed(2), w.endSec.toFixed(2), w.text]),
      );
    });
}
