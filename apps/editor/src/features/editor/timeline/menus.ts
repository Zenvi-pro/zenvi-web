/**
 * Timeline context menus, mirroring the desktop's (zenvi-core
 * src/windows/views/timeline.py ShowClipMenu L1597-2291, ShowTransitionMenu
 * L4847, ShowTrackMenu L4983). Every action is one `session.edit` calling an
 * engine op; the menus only choose which op and preset.
 */
import {
  addTrack,
  applyClipPreset,
  clipsAt,
  findClip,
  findLayer,
  layoutShowAll,
  listMotionTransitions,
  motionRecords,
  removeTrack,
  reverseTransition,
  separateAudio,
  setTrackLocked,
  splitClip,
  type ClipPresetId,
  type ClipPresetOptions,
  type Project,
  type SliceKeep,
} from "@zenvi/engine";
import type { MenuSpec } from "@/ui/Menu";
import { addCaptions, addKineticCaptions, CAPTION_STYLES, KINETIC_CAPTION_STYLES } from "../actions/captions";
import { applyMotionTransition, gridMontage, matchCut, removeMotionTransitions, speedRamp, SPEED_RAMPS } from "../actions/motion";
import { shortcutFor, type EditorCommand } from "../commands";
import { targetCut } from "../cuts";
import { editorToolState } from "../editorTools";
import type { EditorSession } from "../session/EditorSession";
import { EMPTY_SELECTION } from "../session/uiStore";

type Commands = Map<string, EditorCommand>;
const sep: MenuSpec = { type: "separator" };

function cmd(commands: Commands, id: string, label?: string): MenuSpec {
  const command = commands.get(id);
  return {
    type: "item",
    label: label ?? command?.label ?? id,
    shortcut: shortcutFor(id),
    disabled: !command || (command.enabled ? !command.enabled() : false),
    onSelect: () => command?.run(),
  };
}

function presetAction(session: EditorSession, clipIds: string[], label: string, preset: ClipPresetId, opts: ClipPresetOptions = {}): () => void {
  return () => {
    session.edit(label, (tx) => {
      for (const id of clipIds) applyClipPreset(tx, id, preset, opts);
    });
  };
}

function item(label: string, onSelect: () => void, extra: Partial<Extract<MenuSpec, { type: "item" }>> = {}): MenuSpec {
  return { type: "item", label, onSelect, ...extra };
}

function sub(label: string, items: MenuSpec[]): MenuSpec {
  return { type: "sub", label, items };
}

function motionMenu(session: EditorSession, ids: string[]): MenuSpec {
  const p = (label: string, preset: ClipPresetId) => item(label, presetAction(session, ids, label, preset));
  const dirs = (from: boolean) => (from ? ["From Bottom", "From Left", "From Right", "From Top"] : ["To Bottom", "To Left", "To Right", "To Top"]);
  const wipe = (kind: "wipe" | "blur_wipe", way: "in" | "out") => {
    const [b, l, r, t] = dirs(way === "in");
    return [
      p("Circle Expand", `animate.${kind}_${way}_circle_expand` as ClipPresetId),
      p("Circle Shrink", `animate.${kind}_${way}_circle_shrink` as ClipPresetId),
      p(b!, `animate.${kind}_${way}_bottom` as ClipPresetId),
      p(l!, `animate.${kind}_${way}_left` as ClipPresetId),
      p(r!, `animate.${kind}_${way}_right` as ClipPresetId),
      p(t!, `animate.${kind}_${way}_top` as ClipPresetId),
    ];
  };
  return sub("Motion", [
    p("No Motion", "animate.none"),
    sep,
    sub("In", [
      sub("Back In", [p("From Bottom", "animate.back_in_up"), p("From Left", "animate.back_in_left"), p("From Right", "animate.back_in_right"), p("From Top", "animate.back_in_down")]),
      p("Blur In", "animate.blur_in"),
      sub("Bounce In", [
        p("Center", "animate.bounce_in"),
        p("From Bottom", "animate.bounce_in_up"),
        p("From Left", "animate.bounce_in_left"),
        p("From Right", "animate.bounce_in_right"),
        p("From Top", "animate.bounce_in_down"),
      ]),
      p("Pop In", "animate.pop_in"),
      sub("Slide In", [p("From Bottom", "animate.slide_in_bottom"), p("From Left", "animate.slide_in_left"), p("From Right", "animate.slide_in_right"), p("From Top", "animate.slide_in_top")]),
      p("Spiral In", "animate.spiral_in"),
      sub("Wipe In", wipe("wipe", "in")),
      sub("Blur Wipe In", wipe("blur_wipe", "in")),
    ]),
    sub("Out", [
      sub("Back Out", [p("To Bottom", "animate.back_out_down"), p("To Left", "animate.back_out_left"), p("To Right", "animate.back_out_right"), p("To Top", "animate.back_out_up")]),
      p("Blur Out", "animate.blur_out"),
      sub("Bounce Out", [
        p("Center", "animate.bounce_out"),
        p("To Bottom", "animate.bounce_out_down"),
        p("To Left", "animate.bounce_out_left"),
        p("To Right", "animate.bounce_out_right"),
        p("To Top", "animate.bounce_out_up"),
      ]),
      p("Pop Out", "animate.pop_out"),
      sub("Slide Out", [p("To Bottom", "animate.slide_out_bottom"), p("To Left", "animate.slide_out_left"), p("To Right", "animate.slide_out_right"), p("To Top", "animate.slide_out_top")]),
      p("Spiral Out", "animate.spiral_out"),
      sub("Wipe Out", wipe("wipe", "out")),
      sub("Blur Wipe Out", wipe("blur_wipe", "out")),
    ]),
    sub("Emphasis", [
      p("Bounce", "animate.bounce"),
      p("Flash", "animate.flash"),
      p("Heartbeat", "animate.heart_beat"),
      p("Jello", "animate.jello"),
      p("Pulse", "animate.pulse"),
      p("Rubber Band", "animate.rubber_band"),
      p("Shake X", "animate.shake_x"),
      p("Shake Y", "animate.shake_y"),
      p("Swing", "animate.swing"),
      p("Tada", "animate.tada"),
      p("Wobble", "animate.wobble"),
    ]),
    sub("Camera", [
      sub("Zoom", [p("In", "animate.cam_push_in"), p("Out", "animate.cam_pull_out")]),
      sub("Pan", [
        p("Auto Direction", "animate.cam_pan_auto"),
        p("Left to Right", "animate.cam_pan_right"),
        p("Right to Left", "animate.cam_pan_left"),
        p("Top to Bottom", "animate.cam_pan_down"),
        p("Bottom to Top", "animate.cam_pan_up"),
      ]),
      sub("Zoom & Pan", [
        sub("In", [
          p("Auto Direction", "animate.ken_burns_in"),
          p("Left to Right", "animate.ken_burns_in_left_to_right"),
          p("Right to Left", "animate.ken_burns_in_right_to_left"),
          p("Top to Bottom", "animate.ken_burns_in_top_to_bottom"),
          p("Bottom to Top", "animate.ken_burns_in_bottom_to_top"),
        ]),
        sub("Out", [
          p("Auto Direction", "animate.ken_burns_out"),
          p("Left to Right", "animate.ken_burns_out_left_to_right"),
          p("Right to Left", "animate.ken_burns_out_right_to_left"),
          p("Top to Bottom", "animate.ken_burns_out_top_to_bottom"),
          p("Bottom to Top", "animate.ken_burns_out_bottom_to_top"),
        ]),
      ]),
    ]),
    sub("Credits", [p("Scroll Up", "animate.credits_up"), p("Scroll Down", "animate.credits_down")]),
  ]);
}

const SPEED_UP = [2, 4, 8, 16];
const FREEZE_SECONDS = [2, 4, 6, 8, 10, 20, 30];

function speedLabel(factor: number): string {
  return factor >= 1 ? `${factor}X` : `1/${Math.round(1 / factor)}X`;
}

function speedMenu(session: EditorSession, ids: string[]): MenuSpec {
  const t = session.playback.getState().time;
  const speeds = (factors: number[]) =>
    (["forward", "backward"] as const).map((direction) =>
      sub(
        direction === "forward" ? "Forward" : "Backward",
        factors.map((f) => item(speedLabel(f), presetAction(session, ids, `Speed ${speedLabel(f)}`, `time.${direction}`, { speed: f }))),
      ),
    );
  return sub("Speed", [
    item("Reset", presetAction(session, ids, "Reset speed", "time.none")),
    sep,
    item("Reverse", presetAction(session, ids, "Reverse", "time.reverse")),
    sep,
    sub("Speed Up", speeds(SPEED_UP)),
    sub("Slow Down", speeds(SPEED_UP.map((f) => 1 / f))),
    sep,
    sub(
      "Freeze",
      FREEZE_SECONDS.map((s) => item(`${s} seconds`, presetAction(session, ids, "Freeze frame", "time.freeze", { seconds: s, playhead: t }))),
    ),
    sub(
      "Freeze & Zoom",
      FREEZE_SECONDS.map((s) => item(`${s} seconds`, presetAction(session, ids, "Freeze and zoom", "time.freeze_zoom", { seconds: s, playhead: t }))),
    ),
  ]);
}

function audioMenu(session: EditorSession, ids: string[]): MenuSpec {
  const levels = Array.from({ length: 14 }, (_, i) => 130 - i * 10);
  return sub("Audio", [
    sub("Volume", [
      item("Reset Volume", presetAction(session, ids, "Reset volume", "volume.none")),
      sep,
      sub("Level", levels.map((l) => item(`Level ${l}%`, presetAction(session, ids, `Volume ${l}%`, "volume.level", { level: l / 100 })))),
      sep,
      sub("Fade In", [
        item("Fast", presetAction(session, ids, "Fade in audio", "volume.fade_in_fast", { range: "start" })),
        item("Slow", presetAction(session, ids, "Fade in audio", "volume.fade_in_slow", { range: "start" })),
      ]),
      sub("Fade Out", [
        item("Fast", presetAction(session, ids, "Fade out audio", "volume.fade_out_fast", { range: "end" })),
        item("Slow", presetAction(session, ids, "Fade out audio", "volume.fade_out_slow", { range: "end" })),
      ]),
      sub("Fade In and Out", [
        item("Fast", presetAction(session, ids, "Fade audio in and out", "volume.fade_in_out_fast")),
        item("Slow", presetAction(session, ids, "Fade audio in and out", "volume.fade_in_out_slow")),
      ]),
    ]),
    sub("Separate", [
      item("Single Clip (all channels)", () => void session.edit("Separate audio", (tx) => ids.flatMap((id) => separateAudio(tx, id)))),
      item("Multiple Clips (each channel)", () => void session.edit("Separate audio channels", (tx) => ids.flatMap((id) => separateAudio(tx, id, { perChannel: true })))),
    ]),
  ]);
}

/** Motion transitions on the clicked clip's cut (after it, else before it), the clip's ramps, match cut, grid, FX, captions. */
function motionToolsMenu(session: EditorSession, ids: string[], hasVisual: boolean, hasAudio: boolean): MenuSpec[] {
  const project = session.project;
  const first = ids[0]!;
  const out: MenuSpec[] = [];
  if (hasVisual) {
    const cut = targetCut(project, [first], 0);
    const own = cut && (cut.outClip.id === first || cut.inClip.id === first) ? cut : null;
    const presets = listMotionTransitions().map((info) => item(info.title, () => void applyMotionTransition(session, info, "auto", [first])));
    out.push(own ? sub(own.outClip.id === first ? "Motion Transition to Next Clip" : "Motion Transition from Previous Clip", presets) : item("Motion Transition (no cut here)", () => undefined, { disabled: true }));
    if (motionRecords(findClip(project, first)!).length > 0) out.push(item("Remove Motion Transitions", () => void removeMotionTransitions(session, first)));
  }
  if (ids.length === 1) out.push(sub("Speed Ramp", SPEED_RAMPS.map((r) => item(r.label, () => void speedRamp(session, first, r.preset)))));
  if (hasVisual && ids.length >= 2) {
    out.push(item("Match Cut (Align Subjects)", () => void matchCut(session, ids)), item("Grid Montage", () => void gridMontage(session, ids)));
  }
  const fx = editorToolState("apply_fx_tool");
  if (hasVisual && fx.kind === "elsewhere") out.push(item("FX (needs desktop or CLI)", () => undefined, { disabled: true }));
  if (hasAudio && ids.length === 1) {
    const kinetic = editorToolState("kinetic_captions_tool").kind === "ready";
    out.push(
      sub("Captions", [
        ...CAPTION_STYLES.map((c) => item(c.label, () => void addCaptions(session, first, c.style))),
        ...(kinetic ? [sep, ...KINETIC_CAPTION_STYLES.map((c) => item(`Kinetic: ${c.label}`, () => void addKineticCaptions(session, [first], c.style)))] : []),
      ]),
    );
  }
  return out;
}

function sliceMenu(session: EditorSession, ids: string[], project: Project): MenuSpec | null {
  const t = session.playback.getState().time;
  const under = clipsAt(project, t).map((c) => c.id);
  const target = ids.filter((id) => under.includes(id));
  if (target.length === 0) return null;
  const run = (keep: SliceKeep, label: string) => () => void session.edit(label, (tx) => target.map((id) => splitClip(tx, id, t, keep)));
  return sub("Slice", [item("Keep Both Sides", run("both", "Slice")), item("Keep Left Side", run("left", "Slice, keep left")), item("Keep Right Side", run("right", "Slice, keep right"))]);
}

/** Right-click on a clip. `ids` = the selected clips (the clicked one included). */
export function clipMenu(session: EditorSession, commands: Commands, ids: string[]): MenuSpec[] {
  const project = session.project;
  const clips = ids.map((id) => findClip(project, id)).filter((c) => c !== undefined);
  if (clips.length === 0) return [];
  const hasVisual = clips.some((c) => c.reader?.has_video !== false);
  const hasAudio = clips.some((c) => c.reader?.has_audio === true);
  const fade = (label: string, preset: ClipPresetId, range?: ClipPresetOptions["range"]) => item(label, presetAction(session, ids, label === "No Fade" ? "Remove fade" : "Fade", preset, range ? { range } : {}));
  const menu: MenuSpec[] = [
    cmd(commands, "copyAll", "Copy"),
    cmd(commands, "cutAll", "Cut"),
    cmd(commands, "pasteAll", "Paste"),
    cmd(commands, "actionDuplicate", "Duplicate"),
    sep,
    sub("Fade", [
      fade("No Fade", "fade.none"),
      sep,
      sub("Fade In", [fade("Fast", "fade.in_fast", "start"), fade("Slow", "fade.in_slow", "start")]),
      sub("Fade Out", [fade("Fast", "fade.out_fast", "end"), fade("Slow", "fade.out_slow", "end")]),
      sub("Fade In and Out", [fade("Fast", "fade.in_out_fast", "entire"), fade("Slow", "fade.in_out_slow", "entire")]),
    ]),
  ];
  if (hasVisual) menu.push(motionMenu(session, ids));
  if (hasVisual) {
    const layout = (label: string, preset: ClipPresetId) => item(label, presetAction(session, ids, "Layout", preset));
    menu.push(
      sub("Transform", [
        sub("Rotate", [
          item("No Rotation", presetAction(session, ids, "Reset rotation", "rotate.none")),
          sep,
          item("Rotate 90 (Right)", presetAction(session, ids, "Rotate 90° right", "rotate.right_90")),
          item("Rotate 90 (Left)", presetAction(session, ids, "Rotate 90° left", "rotate.left_90")),
          item("Rotate 180 (Flip)", presetAction(session, ids, "Rotate 180°", "rotate.flip_180")),
        ]),
        sub("Layout", [
          layout("Reset Layout", "layout.none"),
          sep,
          layout("1/4 Size - Center", "layout.center"),
          layout("1/4 Size - Top Left", "layout.top_left"),
          layout("1/4 Size - Top Right", "layout.top_right"),
          layout("1/4 Size - Bottom Left", "layout.bottom_left"),
          layout("1/4 Size - Bottom Right", "layout.bottom_right"),
          sep,
          item("Show All (Maintain Ratio)", () => void session.edit("Show all", (tx) => layoutShowAll(tx, ids))),
          item("Show All (Distort)", () => void session.edit("Show all", (tx) => layoutShowAll(tx, ids, { stretch: true }))),
        ]),
      ]),
    );
  }
  menu.push(speedMenu(session, ids));
  if (hasAudio) menu.push(audioMenu(session, ids));
  const motionTools = motionToolsMenu(session, ids, hasVisual, hasAudio);
  if (motionTools.length) menu.push(sep, ...motionTools);
  const slice = sliceMenu(session, ids, project);
  menu.push(sep);
  if (slice) menu.push(slice);
  menu.push(
    item("Properties", () => session.ui.setState({ rightTab: "properties", panels: { ...session.ui.getState().panels, rightCollapsed: false } }), { shortcut: shortcutFor("actionProperties") }),
    sep,
    cmd(commands, "deleteItem", ids.length > 1 ? "Remove Clips" : "Remove Clip"),
  );
  return menu;
}

export function transitionMenu(session: EditorSession, commands: Commands, ids: string[]): MenuSpec[] {
  return [
    cmd(commands, "copyAll", "Copy"),
    sep,
    item("Reverse Transition", () => void session.edit("Reverse transition", (tx) => ids.map((id) => reverseTransition(tx, id)))),
    sep,
    item("Properties", () => session.ui.setState({ rightTab: "properties", panels: { ...session.ui.getState().panels, rightCollapsed: false } })),
    sep,
    cmd(commands, "deleteItem", ids.length > 1 ? "Remove Transitions" : "Remove Transition"),
  ];
}

export function trackMenu(session: EditorSession, layerNumber: number, onRename: () => void): MenuSpec[] {
  const project = session.project;
  const layer = findLayer(project, layerNumber);
  if (!layer) return [];
  return [
    item("Add Track Above", () => void session.edit("Add track", (tx) => addTrack(tx, { above: layerNumber }))),
    item("Add Track Below", () => void session.edit("Add track", (tx) => addTrack(tx, { below: layerNumber }))),
    sep,
    item("Rename Track", onRename),
    item(layer.lock ? "Unlock Track" : "Lock Track", () => void session.edit(layer.lock ? "Unlock track" : "Lock track", (tx) => setTrackLocked(tx, layerNumber, !layer.lock))),
    sep,
    item("Remove Track", () => void session.edit("Remove track", (tx) => removeTrack(tx, layerNumber)), { danger: true, disabled: project.layers.length <= 1 }),
  ];
}

export function markerMenu(session: EditorSession, commands: Commands, markerId: string): MenuSpec[] {
  return [
    item("Go to Marker", () => {
      const marker = session.project.markers.find((m) => m.id === markerId);
      if (marker) session.seek(marker.position);
    }),
    sep,
    item(
      "Remove Marker",
      () => {
        session.ui.setState({ selection: { ...EMPTY_SELECTION, markers: [markerId] } });
        commands.get("deleteItem")?.run();
      },
      { danger: true },
    ),
  ];
}

export function emptyAreaMenu(commands: Commands): MenuSpec[] {
  return [cmd(commands, "pasteAll", "Paste"), sep, cmd(commands, "actionAddMarker"), cmd(commands, "actionAddTrack")];
}
