/**
 * The export dialog's model: the desktop's Simple tab (project type → target
 * → profile → quality, `@zenvi/engine` presets) plus where each target can
 * run here — in this browser (WebCodecs: MP4, MOV, MKV, WebM), in Zenvi
 * Cloud (also GIF and MP3), or only in the desktop app (AVI, MPEG, OGG, DVD).
 */
import {
  ALL_FORMATS,
  DEFAULT_EXPORT_PRESET,
  defaultPresetQuality,
  EXPORT_PRESETS,
  exportContainer,
  exportOptionsForPreset,
  exportPresetsOfType,
  exportPresetTypes,
  getExportPreset,
  presetExportType,
  presetProfileFor,
  presetProfiles,
  presetQualities,
  presetRates,
  type ContainerFormat,
  type ExportPreset,
  type FrameFormat,
  type PresetExportOptions,
  type PresetQuality,
  type Project,
} from "@zenvi/engine";

/** Containers the browser exporter (render-web) writes. */
const BROWSER_CONTAINERS: readonly ContainerFormat[] = ["mp4", "mov", "mkv", "webm", "wav"];
/** Containers a Zenvi Cloud render writes (docs/CLOUD_API.md §5). */
const CLOUD_CONTAINERS: readonly ContainerFormat[] = ["mp4", "mov", "mkv", "webm", "gif", "mp3", "wav"];

export interface TargetSupport {
  container: ContainerFormat | undefined;
  browser: boolean;
  cloud: boolean;
}

export function targetSupport(preset: ExportPreset): TargetSupport {
  const container = exportContainer(preset.videoFormat, presetExportType(preset));
  return { container, browser: !!container && BROWSER_CONTAINERS.includes(container), cloud: !!container && CLOUD_CONTAINERS.includes(container) };
}

/** "Same as the project" in the profile list (the project may use a size no profile has). */
export const PROJECT_PROFILE = "project";

export interface ExportChoice {
  presetId: string;
  /** A profile key, or PROJECT_PROFILE. */
  profile: string;
  quality: PresetQuality;
  /** Keep the sound (Video & Audio targets). */
  sound: boolean;
  range?: { start: number; end: number };
}

export function presetById(id: string): ExportPreset {
  return getExportPreset(id) ?? DEFAULT_EXPORT_PRESET;
}

/** Whether the preset accepts any profile (so "same as project" is offered). */
export function acceptsAnyProfile(preset: ExportPreset): boolean {
  return preset.profiles.length === 0;
}

/** The profile the dialog selects for a preset (desktop: the project's own when allowed). */
export function defaultProfile(project: Project, preset: ExportPreset): string {
  if (acceptsAnyProfile(preset)) return PROJECT_PROFILE;
  return presetProfileFor(preset, project.profile)?.key ?? PROJECT_PROFILE;
}

/** A fresh choice for a preset: its default profile and quality, sound on. */
export function choiceFor(project: Project, preset: ExportPreset, range?: ExportChoice["range"]): ExportChoice {
  return { presetId: preset.id, profile: defaultProfile(project, preset), quality: defaultPresetQuality(preset), sound: true, ...(range ? { range } : {}) };
}

export function frameFor(project: Project, preset: ExportPreset, profile: string): FrameFormat {
  if (profile !== PROJECT_PROFILE) {
    const match = presetProfiles(preset).find((p) => p.key === profile);
    if (match) return { width: match.width, height: match.height, fps: match.fps };
  }
  return { width: project.width, height: project.height, fps: project.fps };
}

/** True when the target writes an audio stream at all (not GIF, not Video Only). */
export function targetHasSound(preset: ExportPreset): boolean {
  return presetExportType(preset) !== "Video Only" && preset.audioCodec !== "" && preset.channels > 0;
}

/** `ExportOptions` for a choice (engine `exportOptionsForPreset`), with the range and sound applied. */
export function exportOptionsFor(project: Project, choice: ExportChoice): PresetExportOptions {
  const preset = presetById(choice.presetId);
  const options = exportOptionsForPreset(preset, { quality: choice.quality, frame: frameFor(project, preset, choice.profile) });
  if (choice.range) options.range = choice.range;
  if (!choice.sound && presetExportType(preset) === "Video & Audio") {
    // "Video Only" (exportOptionsFromSettings): no audio stream.
    delete options.audioCodec;
    delete options.audioBitrate;
    delete options.sampleRate;
    options.channels = 0;
  }
  return options;
}

/** The options a Zenvi Cloud render accepts (documented keys only). */
export function cloudRenderOptions(options: PresetExportOptions): Record<string, unknown> {
  const out: Record<string, unknown> = { format: options.format, width: options.width, height: options.height, fps: options.fps };
  for (const key of ["quality", "videoBitrate", "audioBitrate", "sampleRate", "channels", "range"] as const) {
    if (options[key] !== undefined) out[key] = options[key];
  }
  return out;
}

const VIDEO_CODEC_NAMES: [RegExp, string][] = [
  [/x264|h264|avc/, "H.264"],
  [/x265|hevc|h265/, "H.265"],
  [/vp9/, "VP9"],
  [/libvpx$|vp8/, "VP8"],
  [/prores/, "ProRes"],
  [/av1|rav1e/, "AV1"],
  [/mpeg2/, "MPEG-2"],
  [/mpeg4|xvid/, "MPEG-4"],
  [/theora/, "Theora"],
  [/^gif$/, "GIF"],
];
const AUDIO_CODEC_NAMES: [RegExp, string][] = [
  [/aac/, "AAC"],
  [/vorbis/, "Vorbis"],
  [/opus/, "Opus"],
  [/mp3lame|^mp3$/, "MP3"],
  [/^mp2$/, "MP2"],
  [/ac3/, "AC-3"],
  [/flac/, "FLAC"],
  [/pcm/, "PCM"],
];

function codecName(table: [RegExp, string][], codec: string): string {
  const lower = codec.toLowerCase();
  return table.find(([re]) => re.test(lower))?.[1] ?? codec;
}

function fpsText(fps: { num: number; den: number }): string {
  const rate = fps.num / (fps.den || 1);
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2)} fps`;
}

/** One line about the file a choice makes: "MP4 · H.264 + AAC · 1920 × 1080 · 30 fps · 12 Mb/s". */
export function describeChoice(project: Project, choice: ExportChoice): string {
  const preset = presetById(choice.presetId);
  const frame = frameFor(project, preset, choice.profile);
  const support = targetSupport(preset);
  const type = presetExportType(preset);
  const parts: string[] = [(support.container ?? preset.videoFormat).toUpperCase()];
  const sound = targetHasSound(preset) && choice.sound;
  if (type === "Audio Only") parts.push(codecName(AUDIO_CODEC_NAMES, preset.audioCodec));
  else {
    const video = preset.videoCodec ? codecName(VIDEO_CODEC_NAMES, preset.videoCodec) : "";
    const audio = sound ? codecName(AUDIO_CODEC_NAMES, preset.audioCodec) : "";
    const codecs = [video, audio].filter(Boolean).join(" + ");
    if (codecs) parts.push(sound || !targetHasSound(preset) ? codecs : `${codecs} · no sound`);
    parts.push(`${frame.width} × ${frame.height}`, fpsText(frame.fps));
  }
  const rate = presetRates(preset, choice.quality, frame);
  const rateText = type === "Audio Only" ? rate.audio : rate.video;
  if (rateText && !/^0(\.0+)? /.test(rateText)) {
    const quality = /^(\d+)\s*(crf|cqp|qp)$/i.exec(rateText.trim());
    parts.push(quality ? `${quality[2]!.toUpperCase()} ${quality[1]}` : rateText);
  }
  return parts.join(" · ");
}

export interface QuickPick {
  id: string;
  label: string;
  hint: string;
  presetId: string;
  shape: "project" | "landscape" | "portrait" | "square" | "file";
}

/** The tiles above the selects: the targets people pick most. */
export const QUICK_PICKS: readonly QuickPick[] = ([
  { id: "project", label: "Match project", hint: "MP4 · H.264", presetId: DEFAULT_EXPORT_PRESET.id, shape: "project" },
  { id: "youtube", label: "YouTube", hint: "HD · H.264", presetId: "youtube_HD", shape: "landscape" },
  { id: "youtube4k", label: "YouTube 4K", hint: "2160p · H.264", presetId: "youtube_4K", shape: "landscape" },
  { id: "vertical", label: "Vertical", hint: "TikTok · Reels · Shorts", presetId: "tiktok", shape: "portrait" },
  { id: "instagram", label: "Instagram", hint: "Feed posts", presetId: "instagram", shape: "square" },
  { id: "webm", label: "WebM", hint: "VP9 · open format", presetId: "format_webm_libvp9", shape: "file" },
] satisfies QuickPick[]).filter((pick) => EXPORT_PRESETS.some((p) => p.id === pick.presetId));

/** Which tile a choice matches (the project tile only with the project's own frame). */
export function activePick(choice: ExportChoice): string | null {
  const pick = QUICK_PICKS.find((p) => p.presetId === choice.presetId);
  if (!pick) return null;
  if (pick.shape === "project" && choice.profile !== PROJECT_PROFILE) return null;
  return pick.id;
}

export interface TargetOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** The project-type combo. */
export function projectTypeOptions(): TargetOption[] {
  return exportPresetTypes().map((type) => ({ value: type, label: type === ALL_FORMATS ? "All formats" : type }));
}

/** The target combo for a project type, with where each one runs. */
export function targetOptions(type: string, canCloud: boolean): TargetOption[] {
  return exportPresetsOfType(type).map((preset) => {
    const support = targetSupport(preset);
    if (support.browser) return { value: preset.id, label: preset.title };
    if (support.cloud) return { value: preset.id, label: preset.title, hint: "Zenvi Cloud", disabled: !canCloud };
    return { value: preset.id, label: preset.title, hint: "Desktop app", disabled: true };
  });
}

export function profileOptions(project: Project, preset: ExportPreset): TargetOption[] {
  const options: TargetOption[] = [];
  if (acceptsAnyProfile(preset)) {
    options.push({ value: PROJECT_PROFILE, label: "Same as project", hint: `${project.width} × ${project.height} · ${fpsText(project.fps)}` });
  }
  for (const profile of presetProfiles(preset)) options.push({ value: profile.key, label: profile.description, hint: `${profile.width} × ${profile.height}` });
  return options;
}

export function qualityOptions(preset: ExportPreset): TargetOption[] {
  const label: Record<PresetQuality, string> = { Low: "Low (small file)", Med: "Medium", High: "High" };
  return presetQualities(preset).map((q) => ({ value: q, label: label[q] }));
}
