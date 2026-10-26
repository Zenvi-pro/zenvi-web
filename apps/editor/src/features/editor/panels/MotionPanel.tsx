import { SCENE3D_IDS, SCENE3D_INFO } from "@zenvi/engine";
import { Box, Shapes } from "lucide-react";
import type { ReactNode } from "react";
import { editorToolState, type EditorToolState } from "../editorTools";
import { PanelHeader } from "./PanelChrome";

/**
 * Rendered layers (Zenvi 3D in Blender, Zenvi Motion blocks in headless
 * Chrome) need a host the browser is not: the panel shows what exists and
 * where it runs. A section whose tools are not in this build is hidden.
 */
function Badge({ state }: { state: EditorToolState }) {
  if (state.kind !== "elsewhere") return null;
  return (
    <span title={`In the browser: ${state.note}`} className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-2xs text-fg-subtle">
      Needs desktop or CLI
    </span>
  );
}

function Section({ title, icon, state, children }: { title: string; icon: ReactNode; state: EditorToolState; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-line px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-fg-subtle">{icon}</span>
        <h3 className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">{title}</h3>
        <Badge state={state} />
      </div>
      {children}
    </section>
  );
}

const CLI_HINT = "Run them with the Zenvi CLI (zenvi mcp in Claude Code or ChatGPT): the clip lands in this project as a linked render you can re-render.";

export function MotionPanel() {
  const scenes = editorToolState("add_3d_scene_tool");
  const blocks = editorToolState("add_motion_block_tool");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Motion & 3D" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {scenes.kind !== "missing" ? (
          <Section title="3D scenes" icon={<Box size={14} />} state={scenes}>
            <ul className="space-y-1">
              {SCENE3D_IDS.map((id) => {
                const s = SCENE3D_INFO[id];
                return (
                  <li key={id} className="rounded-md px-1.5 py-1.5 hover:bg-white/[0.03]">
                    <p className="text-sm text-fg">
                      {s.title} <span className="text-2xs text-fg-faint">· {s.placement === "cut" ? "on a cut" : "over the video"} · {s.defaultSeconds} s</span>
                    </p>
                    <p className="text-xs text-fg-subtle">{s.summary}</p>
                  </li>
                );
              })}
            </ul>
            {scenes.kind === "elsewhere" ? <p className="mt-2 text-2xs text-fg-faint">Rendered with Blender. {CLI_HINT}</p> : null}
          </Section>
        ) : null}
        {blocks.kind !== "missing" ? (
          <Section title="Motion blocks" icon={<Shapes size={14} />} state={blocks}>
            <p className="text-xs text-fg-subtle">Parametric motion design: prompt bars that type, glass cards, kinetic headlines, word rotators, counters, text scrambles, HUD callouts, gradient fields.</p>
            {blocks.kind === "elsewhere" ? <p className="mt-2 text-2xs text-fg-faint">Rendered with headless Chrome. {CLI_HINT}</p> : null}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
