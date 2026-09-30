import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ZenviMark } from "@/ui/Logo";

/** A still life of the editor: tracks, clips and a playhead, drawn with CSS. */
function TimelineArt() {
  const rows: { kind: "video" | "audio" | "image"; clips: [number, number][] }[] = [
    { kind: "image", clips: [[44, 18], [70, 14]] },
    { kind: "video", clips: [[4, 30], [35, 22], [58, 34]] },
    { kind: "video", clips: [[12, 26], [40, 40]] },
    { kind: "audio", clips: [[4, 62], [68, 26]] },
  ];
  const tone = {
    video: "bg-clip-video border-clip-video-edge/60",
    audio: "bg-clip-audio border-clip-audio-edge/60",
    image: "bg-clip-image border-clip-image-edge/60",
  };
  return (
    <div className="relative w-full max-w-[520px]" aria-hidden>
      <div className="mb-3 flex items-end gap-[3px]">
        {Array.from({ length: 48 }, (_, i) => (
          <span key={i} className="w-px bg-white/20" style={{ height: i % 8 === 0 ? 10 : 5 }} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((row, r) => (
          <div key={r} className="relative h-9 rounded-sm bg-white/[0.025]">
            {row.clips.map(([left, width], c) => (
              <div
                key={c}
                className={`absolute inset-y-0 overflow-hidden rounded-[4px] border ${tone[row.kind]}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              >
                {row.kind === "audio" ? (
                  <div className="absolute inset-x-1 bottom-1 top-3 flex items-center gap-[2px] opacity-70">
                    {Array.from({ length: 40 }, (_, i) => (
                      <span
                        key={i}
                        className="w-[2px] rounded-full bg-white/70"
                        style={{ height: `${20 + Math.abs(Math.sin(i * 1.7 + c)) * 70}%` }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="h-2.5 bg-white/10" />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="absolute -bottom-3 -top-2 left-[38%] w-px bg-accent shadow-[0_0_12px_rgba(50,117,248,0.8)]">
        <span className="absolute -left-[5px] -top-1 h-2.5 w-[11px] rounded-[2px] bg-accent" />
      </div>
    </div>
  );
}

export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-full bg-base">
      <aside className="relative hidden w-[46%] shrink-0 flex-col justify-between overflow-hidden border-r border-line bg-canvas p-8 lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(50,117,248,0.12),transparent_55%)]" />
        <Link to="/" className="relative z-10 flex items-center gap-2.5 text-fg">
          <ZenviMark size={24} />
          <span className="text-lg font-semibold tracking-tight">Zenvi</span>
        </Link>
        <div className="relative z-10 flex flex-1 items-center justify-center py-12">
          <TimelineArt />
        </div>
        <div className="relative z-10">
          {aside ?? (
            <>
              <p className="font-serif text-4xl leading-[1.05] text-fg">Edit anywhere.</p>
              <p className="mt-2 max-w-sm text-md text-fg-subtle">
                The Zenvi editor in your browser. Your media stays on your device until you choose to share it.
              </p>
            </>
          )}
        </div>
      </aside>
      <main className="relative flex min-h-full flex-1 flex-col items-center justify-center px-4 py-16 sm:px-8">
        <Link to="/" className="absolute left-5 top-5 flex items-center gap-2 text-fg lg:hidden">
          <ZenviMark size={20} />
          <span className="text-md font-semibold tracking-tight">Zenvi</span>
        </Link>
        <div className="w-full max-w-[400px] animate-rise-in">{children}</div>
      </main>
    </div>
  );
}
