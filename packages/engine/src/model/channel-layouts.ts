/**
 * Audio channel layouts by the names people use for them.
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/project_export.py `CHANNEL_LAYOUTS` and
 * src/classes/editor_tools/project_export_profiles.py `_LAYOUT_BY_NAME`,
 * shared by set_project_setting_tool and export_video_tool (`channels`).
 */

import { ChannelLayout } from "./defaults.js";

export type ChannelName = "mono" | "stereo" | "surround" | "5.1" | "7.1";

/** `_LAYOUT_BY_NAME`: a name or a channel count → the layout. */
export const LAYOUT_BY_NAME: Readonly<Record<string, ChannelName>> = {
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

/** `CHANNEL_LAYOUTS`: libopenshot ChannelLayout code and channel count. */
export const CHANNEL_LAYOUTS: Readonly<Record<ChannelName, readonly [number, number]>> = {
  mono: [ChannelLayout.MONO, 1],
  stereo: [ChannelLayout.STEREO, 2],
  surround: [ChannelLayout.SURROUND, 3],
  "5.1": [ChannelLayout.FIVE_POINT_ONE, 6],
  "7.1": [ChannelLayout.SEVEN_POINT_ONE, 8],
};

/** The layout a name or count means ("Stereo", "5.1", "2"), or null. */
export function channelLayoutNamed(text: unknown): ChannelName | null {
  return LAYOUT_BY_NAME[String(text ?? "").trim().toLowerCase()] ?? null;
}
