/**
 * Video profiles: list_project_profiles_tool, set_project_profile_tool,
 * set_project_setting_tool, manage_custom_profiles_tool.
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/project_export_profiles.py. Profile requests
 * resolve in model/profile-requests.ts; the switch and the reframe are the
 * engine's ops (applyProfile, planReframe), one undo step together.
 * set_project_setting_tool goes through the same switch, so a new size or
 * frame rate also renames the project's profile (the desktop re-applies a
 * project's profile by name when it opens it), and sets the audio format
 * (setProjectAudio) in the same step.
 *
 * Custom profiles live where Zenvi desktop reads them: its user profiles
 * folder (`~/.openshot_qt/profiles`), which the CLI on the same computer
 * reads and writes (StorageHost.customProfiles). A project names its profile,
 * and the desktop re-applies the named profile when it opens one (HD 720p
 * 30 fps when it does not know it), so a surface without that folder (the
 * web editor, Zenvi Cloud) lists the built-in profiles only and refuses to
 * make one rather than keep a profile the desktop would never see.
 */

import type { Project } from "../../model/types.js";
import {
  aspectText,
  describeProfile,
  parseProfileFile,
  profileFileText,
  profileFpsFraction,
  profileKey,
  reducedDisplayRatio,
  type CatalogProfile,
  type Profile,
} from "../../model/profiles.js";
import {
  ensureProfile,
  flipProfile,
  fpsValue,
  matchProfile,
  profileCatalog,
  ProfileRequestError,
  resolveProfileRequest,
  SOCIAL_PRESETS,
  socialPreset,
  type ProfileChoice,
  type ProfileContext,
} from "../../model/profile-requests.js";
import { ChannelLayout } from "../../model/defaults.js";
import { applyProfile, applyReframe, planReframe, profileDiffers, setProjectAudio, type ProjectAudio, type ReframeMode, type ReframePlan } from "../../ops/project.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { projectFps } from "../frame-time.js";
import { pyFloat, pyG, pyReprString } from "../pyfmt.js";
import type { ToolReceipt } from "../receipt.js";
import { fileById, text } from "./common.js";
import { editorRun, nothingChanged, ok, ToolError } from "./timeline-edit-common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;
const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** Why a surface keeps no custom profiles (see the module comment). */
export const CUSTOM_PROFILE_HOME =
  "custom profiles live in Zenvi desktop's profiles folder, which Zenvi desktop and the zenvi CLI on the same computer use; " +
  "a project whose profile Zenvi desktop does not know opens there as HD 720p 30 fps";

/** The user's custom profiles from the host (none where the host keeps none). */
async function customProfiles(call: ToolCall): Promise<CatalogProfile[]> {
  const storage = call.host.storage;
  if (!storage?.customProfiles) return [];
  const out: CatalogProfile[] = [];
  for (const file of await storage.customProfiles()) {
    const profile = parseProfileFile(file.text, file.name);
    if (profile) out.push({ ...profile, user: true, path: file.path });
  }
  return out;
}

/** The catalog (custom profiles first) and the project's frame rate. */
export async function profileContext(call: ToolCall): Promise<ProfileContext> {
  const fps = projectFps(call.doc.project);
  return { catalog: profileCatalog(await customProfiles(call)), projectFps: fps.num / fps.den };
}

/** Run profile resolution; its refusals are the desktop's ToolError text. */
export function resolving<T>(body: () => T): T {
  try {
    return body();
  } catch (error) {
    if (error instanceof ProfileRequestError) throw new ToolError(error.message);
    throw error;
  }
}

/** `f"{fps:.2f}".rstrip("0").rstrip(".")`. */
function fpsWords(profile: Profile): string {
  return fpsValue(profile).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Save a new custom profile (ensure_profile writes one when no profile has
 * the size and rate) before a project uses it; refused where the host keeps
 * no custom profiles.
 */
export async function keepCustomProfile(call: ToolCall, choice: ProfileChoice): Promise<CatalogProfile> {
  if (!choice.create) return choice.profile;
  const { profile } = choice;
  const what = `no built-in profile is ${profile.width}x${profile.height} at ${fpsWords(profile)} fps and a custom one could not be saved`;
  const storage = call.host.storage;
  if (!storage?.writeCustomProfile) throw new ToolError(`${what}: ${CUSTOM_PROFILE_HOME}. Pick a built-in size (list_project_profiles_tool)`);
  try {
    const path = await storage.writeCustomProfile(profile.key, profileFileText(profile));
    return { ...profile, user: true, path };
  } catch (error) {
    throw new ToolError(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The project's own frame format as a profile record (a profile this surface's catalog does not have). */
function currentProfile(project: Project): CatalogProfile {
  const fps = projectFps(project);
  const dar = project.display_ratio ?? reducedDisplayRatio(project.width, project.height);
  const record = {
    description: String(project.profile ?? ""),
    width: Math.trunc(project.width),
    height: Math.trunc(project.height),
    fps,
    progressive: true,
    pixel_ratio: project.pixel_ratio ? { num: project.pixel_ratio.num, den: project.pixel_ratio.den } : { num: 1, den: 1 },
    display_ratio: { num: dar.num, den: dar.den },
    spherical: false,
  };
  return { ...record, key: profileKey(record), user: false };
}

interface TargetArgs {
  profile: string;
  width: number;
  height: number;
  fps: number;
  orientation: string;
  fromFileId: string;
}

/** `_target_record`: the profile a set_project_profile_tool call asks for. */
export function targetProfile(call: ToolCall, ctx: ProfileContext, args: TargetArgs): ProfileChoice {
  const project = call.doc.project;
  const fps = Number(args.fps) || null;
  return resolving(() => {
    if (args.fromFileId) {
      const file = fileById(project, args.fromFileId.trim());
      if (!file) throw new ToolError(`no project file with id=${pyReprString(args.fromFileId)}`);
      if (!file.has_video || file.media_type === "audio") throw new ToolError("that file has no picture; pick a video or image file");
      const fw = Math.trunc(Number(file.width) || 0);
      const fh = Math.trunc(Number(file.height) || 0);
      if (!fw || !fh) throw new ToolError("that file's picture size is unknown; give width and height");
      const ffps = (file.fps ?? {}) as { num?: unknown; den?: unknown };
      const fileFps = fps || (file.media_type === "video" ? (Number(ffps.num) || 30) / (Number(ffps.den) || 1) : ctx.projectFps);
      return ensureProfile(ctx, fw, fh, profileFpsFraction(fileFps));
    }
    let choice: ProfileChoice;
    if (args.width || args.height) {
      if (!(args.width && args.height)) throw new ToolError("give both width and height");
      if (args.width % 2 || args.height % 2) throw new ToolError("width and height must be even numbers (H.264 needs even sizes)");
      choice = ensureProfile(ctx, args.width, args.height, profileFpsFraction(fps || ctx.projectFps));
    } else if (args.profile.trim()) {
      choice = resolveProfileRequest(ctx, args.profile, fps);
    } else {
      const found = matchProfile(ctx.catalog, project.width, project.height, fps || ctx.projectFps);
      // A size no profile of this surface has keeps the project's own profile (the desktop's catalog has it).
      choice = found
        ? { profile: found, create: false }
        : fps
          ? ensureProfile(ctx, project.width, project.height, profileFpsFraction(fps))
          : { profile: currentProfile(project), create: false };
    }
    return args.orientation ? flipProfile(ctx, choice, args.orientation, fps) : choice;
  });
}

/** The project's profile values for `previous_profile`. */
function profileSnapshot(project: Project): Record<string, unknown> {
  const fps = projectFps(project);
  const dar = project.display_ratio ?? reducedDisplayRatio(project.width, project.height);
  return {
    profile: String(project.profile ?? ""),
    width: project.width,
    height: project.height,
    fps: Math.round((fps.num / fps.den) * 1000) / 1000,
    aspect: aspectText(dar.num, dar.den),
  };
}

/** `_profile_receipt`. */
function profileReceipt(
  call: ToolCall,
  result: { changed: boolean; reframed: string[]; skipped: { timeline_clip_id: string; reason: string }[]; letterboxed: string[]; videoClips: number },
  before: Record<string, unknown>,
  profile: CatalogProfile,
  reframe: ReframeMode,
  socialKey: string | null,
): ToolReceipt {
  const after = describeProfile(profile);
  let social = socialKey && SOCIAL_PRESETS[socialKey] ? SOCIAL_PRESETS[socialKey]![3] : null;
  if (social === null) {
    for (const spec of Object.values(SOCIAL_PRESETS)) {
      if (spec[0] === after.width && spec[1] === after.height) {
        social = spec[3];
        break;
      }
    }
  }
  const parts: string[] = [];
  if (result.changed) parts.push(`Project is now ${after.name} (${after.width}x${after.height} ${after.aspect}, ${pyFloat(after.fps)} fps)`);
  else parts.push(`Project already uses ${after.name}`);
  if (result.reframed.length > 0) parts.push(`${result.reframed.length} clip(s) set to ${reframe === "fill" ? "crop-to-fill" : "fit"}`);
  if (result.letterboxed.length > 0) {
    parts.push(`${result.letterboxed.length} clip(s) of another shape will show bars; call again with reframe='fill' to crop them to fill the frame`);
  }
  if (reframe === "fill" && !result.videoClips) {
    parts.push(
      "the timeline has no video clips yet, so nothing was reframed: clips placed later are fitted with bars when their shape differs, " +
        "so call set_project_profile_tool(reframe='fill') again once they are on the timeline",
    );
  }
  const data = {
    changed: result.changed,
    profile: after,
    previous_profile: before,
    reframe,
    reframed_clip_ids: result.reframed,
    skipped: result.skipped,
    letterboxed_clip_ids: result.letterboxed,
    suggested_export_preset: social,
  };
  const summary = `${parts.join("; ")}.`;
  return result.changed || result.reframed.length > 0 ? ok(call, summary, data) : nothingChanged(call, summary, data);
}

const PIXEL_RATIO_RE = /^\s*(\d+)\s*[:/]\s*(\d+)\s*$/;

type ChannelName = "mono" | "stereo" | "surround" | "5.1" | "7.1";

/** project_export_profiles._LAYOUT_BY_NAME. */
const LAYOUT_BY_NAME: Readonly<Record<string, ChannelName>> = {
  mono: "mono",
  "1": "mono",
  stereo: "stereo",
  "2": "stereo",
  surround: "surround",
  "3": "surround",
  "5.1": "5.1",
  "6": "5.1",
  "7.1": "7.1",
  "8": "7.1",
};
/** project_export.CHANNEL_LAYOUTS: libopenshot ChannelLayout code and channel count. */
const CHANNEL_LAYOUTS: Readonly<Record<ChannelName, readonly [number, number]>> = {
  mono: [ChannelLayout.MONO, 1],
  stereo: [ChannelLayout.STEREO, 2],
  surround: [ChannelLayout.SURROUND, 3],
  "5.1": [ChannelLayout.FIVE_POINT_ONE, 6],
  "7.1": [ChannelLayout.SEVEN_POINT_ONE, 8],
};
/** project_export_profiles._LAYOUT_SETTING: the Preferences value of each layout. */
const LAYOUT_SETTING: Readonly<Record<ChannelName, string>> = {
  mono: "LAYOUT_MONO",
  stereo: "LAYOUT_STEREO",
  surround: "LAYOUT_SURROUND",
  "5.1": "LAYOUT_5POINT1",
  "7.1": "LAYOUT_7POINT1",
};
const SAMPLE_RATES = [22050, 44100, 48000, 96000, 192000] as const;

/** project_export._channel_layout_name. */
function channelLayoutName(value: unknown): string {
  const hit = (Object.entries(CHANNEL_LAYOUTS) as [ChannelName, readonly [number, number]][]).find(([, [code]]) => value === code);
  return hit ? hit[0] : value === undefined || value === null || value === 0 || value === "" ? "" : String(value);
}

/**
 * save_as_default: the sample rate and channels become the defaults for new
 * projects in the editor's own settings (the desktop's Preferences keys
 * `default-samplerate` / `default-channellayout`), stored once the project
 * has changed. Refused, before anything changes, on a surface whose
 * settings have no such defaults: the web editor's have none (its projects
 * start at 48000 Hz stereo), and the CLI and Zenvi Cloud have no editor
 * settings at all.
 */
function defaultAudioSettings(call: ToolCall, sampleRate: number | null, layout: ChannelName | null): () => void {
  const ui = call.host.ui;
  const entries = ui?.preferences?.() ?? null;
  const again = "call again without save_as_default to change only this project";
  if (entries === null || !ui?.setPreference) {
    throw new ToolError(
      "save_as_default keeps the sample rate and channels for new projects in an editor's settings " +
        `(Zenvi desktop: Preferences > Default Audio Sample Rate / Channels); there is no editor window here, so ${again}`,
    );
  }
  const wanted: [string, string | number][] = [];
  if (sampleRate !== null) wanted.push(["default-samplerate", sampleRate]);
  if (layout !== null) wanted.push(["default-channellayout", LAYOUT_SETTING[layout]]);
  for (const [key] of wanted) {
    const entry = entries.find((e) => e.key === key);
    if (!entry || entry.readOnly) {
      throw new ToolError(
        `this editor's settings have no default ${key === "default-samplerate" ? "sample rate" : "channels"} for new projects ` +
          `(new projects here start at 48000 Hz stereo; Zenvi desktop keeps them in Preferences), so ${again}`,
      );
    }
  }
  return () => {
    for (const [key, value] of wanted) ui.setPreference!(key, value);
  };
}

/** `project_snapshot()` fields set_project_setting_tool reports. */
function settingsSnapshot(project: Project): Record<string, unknown> {
  const fps = projectFps(project);
  return {
    width: project.width,
    height: project.height,
    fps: Math.round((fps.num / fps.den) * 1000) / 1000,
    fps_num: fps.num,
    fps_den: fps.den,
    profile: String(project.profile ?? ""),
    sample_rate: Math.trunc(Number(project.sample_rate) || 0),
    channels: Math.trunc(Number(project.channels) || 0),
    channel_layout: channelLayoutName(project.channel_layout),
  };
}

export const projectProfileTools: CatalogTool[] = [
  contractTool("list_project_profiles_tool", {
    annotations: READ,
    run: async (call, input) => {
      const ctx = await profileContext(call);
      const tokens = (input.query ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
      const width = input.width ?? 0;
      const height = input.height ?? 0;
      const fps = input.fps ?? 0;
      const aspect = (input.aspect ?? "").replaceAll("x", ":").trim();
      const orientation = input.orientation ?? "";
      const rows = [];
      for (const p of ctx.catalog) {
        const d = describeProfile(p);
        if (tokens.length > 0 && !tokens.every((t) => `${p.description} ${p.key}`.toLowerCase().includes(t))) continue;
        if ((width && d.width !== width) || (height && d.height !== height)) continue;
        if (fps && Math.abs(d.fps - fps) > 0.011) continue;
        if (aspect && d.aspect !== aspect) continue;
        if (orientation && d.orientation !== orientation) continue;
        rows.push(d);
      }
      const total = rows.length;
      // Custom profiles first, then the largest frames, then the lowest rates (a stable sort).
      rows.sort((a, b) => Number(!a.user) - Number(!b.user) || b.width * b.height - a.width * a.height || a.fps - b.fps);
      const limit = input.limit ?? 30;
      const out: Record<string, unknown> = { profiles: rows.slice(0, limit), total_matches: total, current: call.doc.project.profile || "" };
      if (input.include_social_presets ?? true) {
        out.social_presets = Object.entries(SOCIAL_PRESETS).map(([name, [w, h, f, preset, aliases]]) => ({
          name,
          width: w,
          height: h,
          fps: f ?? "project fps",
          export_preset: preset,
          aliases: aliases.slice(0, 4),
        }));
      }
      const showing = total > limit ? `; showing ${Math.min(total, limit)}` : "";
      return ok(call, `${total} profile(s) match${showing}.`, out);
    },
  }),

  contractTool("set_project_profile_tool", {
    annotations: EDIT,
    run: (call, input) =>
      editorRun(async () => {
        const reframe = (input.reframe ?? "keep") as ReframeMode;
        const args: TargetArgs = {
          profile: text(input.profile),
          width: input.width ?? 0,
          height: input.height ?? 0,
          fps: input.fps ?? 0,
          orientation: input.orientation ?? "",
          fromFileId: text(input.from_file_id),
        };
        if (!args.profile && !args.width && !args.height && !args.fps && !args.orientation && !args.fromFileId && reframe === "keep") {
          throw new ToolError("say what to change: profile (name or social preset), width+height, fps, orientation, from_file_id, or reframe");
        }
        const ctx = await profileContext(call);
        const profile = await keepCustomProfile(call, targetProfile(call, ctx, args));
        const project = call.doc.project;
        const before = profileSnapshot(project);
        const plan = planReframe(project, reframe, profile.width, profile.height);
        const changed = profileDiffers(project, profile);
        if (changed || plan.changes.length > 0) {
          call.commit((tx) => {
            applyProfile(tx, profile);
            applyReframe(tx, plan);
          }, "Set project format");
        }
        const socialKey = args.profile ? (socialPreset(args.profile)?.key ?? null) : null;
        return profileReceipt(
          call,
          { changed, reframed: plan.changes.map((c) => c.id), skipped: plan.skipped, letterboxed: plan.letterboxed, videoClips: plan.videoClips },
          before,
          profile,
          reframe,
          socialKey,
        );
      }),
  }),

  contractTool("set_project_setting_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    run: (call, input) =>
      editorRun(async () => {
        const project = call.doc.project;
        const fpsNum = input.fps_num ?? null;
        const fpsDen = input.fps_den ?? null;
        let fps = input.fps ?? null;
        let width = input.width ?? null;
        let height = input.height ?? null;
        const sampleRate = input.sample_rate ?? null;
        const profileArg = text(input.profile) || text(input.preset);
        const orientation = input.orientation ?? "";
        const reframe = (input.reframe ?? "keep") as ReframeMode;
        const videoRequested = [fps, fpsNum, fpsDen, width, height].some((v) => v !== null && v !== 0) || Boolean(profileArg) || Boolean(orientation);
        if (fpsNum !== null || fpsDen !== null) {
          if (fpsNum === null || fpsDen === null) throw new ToolError("give both fps_num and fps_den");
          fps = fpsNum / fpsDen;
        }
        let layout: ChannelName | null = null;
        const channels = text(input.channels);
        if (channels) {
          layout = LAYOUT_BY_NAME[channels.toLowerCase()] ?? null;
          if (!layout) throw new ToolError("channels must be mono, stereo, surround, 5.1 or 7.1 (or 1, 2, 3, 6, 8)");
        }
        if (sampleRate !== null && !(SAMPLE_RATES as readonly number[]).includes(sampleRate)) {
          throw new ToolError(`sample_rate must be one of ${SAMPLE_RATES.join(", ")}`);
        }
        if (!videoRequested && sampleRate === null && !layout && reframe === "keep") {
          throw new ToolError("nothing to change: pass fps, width/height, profile/preset, orientation, sample_rate or channels");
        }
        // Checked before anything changes: a surface without such settings refuses the whole call.
        const storeDefaults = input.save_as_default && (sampleRate !== null || layout !== null) ? defaultAudioSettings(call, sampleRate, layout) : null;

        let profile: CatalogProfile | null = null;
        if (videoRequested || reframe !== "keep") {
          if ((width === null) !== (height === null)) {
            width = width ?? project.width;
            height = height ?? project.height;
          }
          const ctx = await profileContext(call);
          let choice = targetProfile(call, ctx, { profile: profileArg, width: width ?? 0, height: height ?? 0, fps: fps ?? 0, orientation, fromFileId: "" });
          if (fpsNum !== null && fpsDen !== null && (choice.profile.fps.num !== fpsNum || choice.profile.fps.den !== fpsDen)) {
            const base = choice.profile;
            choice = resolving(() => ensureProfile(ctx, base.width, base.height, { num: fpsNum, den: fpsDen }));
          }
          profile = await keepCustomProfile(call, choice);
        }

        const audio: ProjectAudio = {};
        if (sampleRate !== null && Math.trunc(Number(project.sample_rate) || 0) !== sampleRate) audio.sampleRate = sampleRate;
        if (layout) {
          const [code, count] = CHANNEL_LAYOUTS[layout];
          if (project.channel_layout !== code || Math.trunc(Number(project.channels) || 0) !== count) audio.channels = { count, layout: code };
        }
        const plan: ReframePlan = profile ? planReframe(project, reframe, profile.width, profile.height) : { changes: [], skipped: [], letterboxed: [], videoClips: 0 };
        const changedProfile = profile ? profileDiffers(project, profile) : false;
        const changed = changedProfile || plan.changes.length > 0 || Object.keys(audio).length > 0;
        if (changed) {
          call.commit((tx) => {
            if (profile && (changedProfile || plan.changes.length > 0)) {
              applyProfile(tx, profile);
              applyReframe(tx, plan);
            }
            setProjectAudio(tx, audio);
          }, "Set project settings");
        }
        storeDefaults?.();

        const after = settingsSnapshot(call.doc.project);
        const notes: string[] = [];
        if (changedProfile) notes.push(`${String(after.width)}x${String(after.height)} at ${pyFloat(Number(after.fps))} fps (${String(after.profile)})`);
        if (plan.changes.length > 0) notes.push(`${plan.changes.length} clip(s) reframed`);
        if (Object.keys(audio).length > 0) notes.push(`audio ${String(after.sample_rate)} Hz ${String(after.channel_layout)}`);
        let summary = changed ? `Updated project settings: ${notes.join(", ")}.` : "Settings already matched.";
        if (plan.letterboxed.length > 0) summary += ` ${plan.letterboxed.length} clip(s) of another shape will show bars; pass reframe='fill' to crop them.`;
        const data = {
          changed,
          ...after,
          reframed_clip_ids: plan.changes.map((c) => c.id),
          letterboxed_clip_ids: plan.letterboxed,
          saved_as_default: storeDefaults !== null,
        };
        return changed ? ok(call, summary, data) : nothingChanged(call, summary, data);
      }),
  }),

  contractTool("manage_custom_profiles_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, input) =>
      editorRun(async () => {
        const storage = call.host.storage;
        if (!storage?.customProfiles || !storage.writeCustomProfile || !storage.removeCustomProfile) {
          return unavailable(call.tool, `${CUSTOM_PROFILE_HOME}. The built-in profiles work everywhere (list_project_profiles_tool).`);
        }
        const action = input.action;
        if (action === "set_default") {
          return unavailable(
            call.tool,
            "the default profile for new projects is a Zenvi desktop preference (Preferences > Default Profile), kept in its settings file, " +
              "which only the desktop app writes; set it there. New projects here take a profile when they are made (zenvi new --profile, new_project_tool).",
          );
        }
        const ctx = await profileContext(call);
        const profileArg = text(input.profile);
        const base = profileArg ? await keepCustomProfile(call, resolving(() => resolveProfileRequest(ctx, profileArg))) : null;
        if ((action === "duplicate" || action === "edit" || action === "delete") && !base) {
          throw new ToolError(`${action} needs 'profile' (an existing profile name or key)`);
        }
        if ((action === "edit" || action === "delete") && !base!.user) {
          throw new ToolError(`'${base!.description}' is a built-in profile; duplicate it to make a custom copy`);
        }
        if (action === "delete") {
          if (base!.description.trim() === String(call.doc.project.profile ?? "").trim()) {
            throw new ToolError("you cannot delete the current project's profile or the default profile");
          }
          try {
            await storage.removeCustomProfile(base!.key);
          } catch (error) {
            throw new ToolError(`could not delete ${base!.path ?? base!.key}: ${error instanceof Error ? error.message : String(error)}`);
          }
          return ok(call, `Deleted the custom profile '${base!.description}'. No clip changed.`, { deleted: base!.description, path: base!.path ?? base!.key });
        }

        const src = base;
        const w = input.width || src?.width || 0;
        const h = input.height || src?.height || 0;
        if (!(w && h)) throw new ToolError("give width and height (or a 'profile' to start from)");
        if (w % 2 || h % 2) throw new ToolError("width and height must be even");
        const fps = input.fps ? profileFpsFraction(input.fps) : src ? { ...src.fps } : { num: 30, den: 1 };
        let par = { num: 1, den: 1 };
        const parText = text(input.pixel_ratio);
        if (parText) {
          const m = PIXEL_RATIO_RE.exec(parText);
          if (!m || !Number(m[1]) || !Number(m[2])) throw new ToolError("pixel_ratio must look like '1:1' or '10:11'");
          par = { num: Number(m[1]), den: Number(m[2]) };
        } else if (src) {
          par = { ...src.pixel_ratio };
        }
        let desc = text(input.name);
        if (action === "edit" && !desc) desc = src!.description;
        if (action === "duplicate" && !desc) desc = `${src!.description} (copy)`;
        if (!desc) desc = `Custom ${w}x${h} ${(fps.num / fps.den).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} fps`;
        for (const p of ctx.catalog) {
          if (p.description.trim() === desc && !(action === "edit" && p.user && p.key === src?.key)) {
            throw new ToolError(`a profile named '${desc}' already exists; pick a unique name`);
          }
        }
        const record = {
          description: desc,
          width: w,
          height: h,
          fps,
          progressive: !input.interlaced,
          pixel_ratio: par,
          display_ratio: reducedDisplayRatio(w, h, par.num, par.den),
          spherical: Boolean(input.spherical),
        };
        let name = action === "edit" ? src!.key : profileKey(record);
        if (action !== "edit") {
          const taken = new Set(ctx.catalog.filter((p) => p.user).map((p) => p.key));
          const stem = name;
          for (let suffix = 1; taken.has(name); suffix += 1) name = `${stem}-${suffix}`;
        }
        let path: string;
        try {
          path = await storage.writeCustomProfile(name, profileFileText({ ...record, key: name }));
        } catch (error) {
          throw new ToolError(`could not save the profile: ${error instanceof Error ? error.message : String(error)}`);
        }
        const verb = action === "edit" ? "Updated" : "Created";
        return ok(call, `${verb} custom profile '${desc}' (${w}x${h}, ${pyG(fps.num / fps.den, 3)} fps).`, {
          profile: describeProfile({ ...record, key: name, user: true }),
          path,
        });
      }),
  }),
];
