import { Coins, LogIn, Mic, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { checkOperation, creditBalance, type OperationCheck } from "@/lib/credits";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Select } from "@/ui/Select";
import { toast } from "@/ui/Toast";
import { defaultTrack } from "../actions/importMedia";
import { useProjectSelector, useSession } from "../session/context";
import { generateVideo, generateVoiceover, TTS_VOICES, type TtsVoice } from "./generate";
import { PanelEmpty, PanelHeader, Segmented } from "./PanelChrome";

type Shape = "landscape" | "portrait" | "square";

const SHAPES: Record<Shape, { width: number; height: number; label: string }> = {
  landscape: { width: 1280, height: 720, label: "16:9" },
  portrait: { width: 720, height: 1280, label: "9:16" },
  square: { width: 960, height: 960, label: "1:1" },
};

function Card({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-raised p-3">
      <div className="mb-2.5 flex items-start gap-2">
        <span className="mt-0.5 text-accent-hover">{icon}</span>
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="text-xs text-fg-subtle">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);
  return seconds;
}

export function GeneratePanel() {
  const session = useSession();
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const projectShape = useProjectSelector((p): Shape => (p.width > p.height ? "landscape" : p.width < p.height ? "portrait" : "square"));
  const [balance, setBalance] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<5 | 10>(5);
  const [shape, setShape] = useState<Shape>(projectShape);
  const [videoCost, setVideoCost] = useState<OperationCheck | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<TtsVoice>("alloy");
  const [speed, setSpeed] = useState(1);
  const [ttsBusy, setTtsBusy] = useState(false);
  const elapsed = useElapsed(videoBusy);

  useEffect(() => {
    if (status !== "signed-in") return;
    void creditBalance().then(setBalance);
  }, [status, videoBusy, ttsBusy]);

  useEffect(() => {
    if (status !== "signed-in") return;
    let cancelled = false;
    void checkOperation("video_generation", 1, duration).then((c) => !cancelled && setVideoCost(c));
    return () => {
      cancelled = true;
    };
  }, [status, duration]);

  if (status === "disabled") return <PanelEmpty icon={<Sparkles size={22} />} title="Generation needs sign-in" body="Sign-in is off in this build." />;
  if (status !== "signed-in") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PanelHeader title="Generate" />
        <PanelEmpty icon={<Sparkles size={22} />} title="AI video and voiceovers" body="Generate clips from a prompt and narration from text. Sign in to use your Zenvi credits.">
          <Button variant="white" size="md" icon={<LogIn size={14} />} disabled={status === "loading"} onClick={() => navigate(`/login?next=${encodeURIComponent(`/p/${session.meta.getState().id}`)}`)}>
            Sign in
          </Button>
        </PanelEmpty>
      </div>
    );
  }

  const placement = () => {
    const layer = defaultTrack(session.project);
    return layer === null ? null : { position: session.playback.getState().time, layer };
  };

  const runVideo = async () => {
    setVideoBusy(true);
    try {
      const size = SHAPES[shape];
      await generateVideo(session, { prompt: prompt.trim(), durationSeconds: duration, width: size.width, height: size.height }, placement());
      toast.success("AI video added", { description: "It's in Project Files and on the timeline at the playhead." });
      setPrompt("");
    } catch (error) {
      toast.error("Video generation failed", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setVideoBusy(false);
    }
  };

  const runTts = async () => {
    setTtsBusy(true);
    try {
      await generateVoiceover(session, text.trim(), voice, speed, placement());
      toast.success("Voiceover added at the playhead");
      setText("");
    } catch (error) {
      toast.error("Voiceover failed", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setTtsBusy(false);
    }
  };

  const blocked = videoCost ? !videoCost.allowed : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Generate">
        {balance !== null ? (
          <span className="mr-1.5 inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-xs tnum text-fg-muted" title="Zenvi credits left">
            <Coins size={12} /> {balance.toLocaleString()}
          </span>
        ) : null}
      </PanelHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <Card icon={<Sparkles size={15} />} title="AI video" hint="From a text prompt. Takes one to three minutes.">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="A slow aerial shot over misty pine forest at sunrise"
            aria-label="Video prompt"
            className="w-full resize-none rounded-md border border-line-strong bg-white/[0.03] px-2.5 py-2 text-sm text-fg outline-none placeholder:text-fg-faint focus:border-accent"
          />
          <div className="mt-2 flex items-center gap-2">
            <Segmented<"5" | "10">
              label="Length"
              value={String(duration) as "5" | "10"}
              onChange={(v) => setDuration(v === "10" ? 10 : 5)}
              options={[
                { value: "5", label: "5 s" },
                { value: "10", label: "10 s" },
              ]}
            />
            <Segmented<Shape>
              label="Shape"
              value={shape}
              onChange={setShape}
              options={(Object.keys(SHAPES) as Shape[]).map((s) => ({ value: s, label: SHAPES[s].label }))}
            />
          </div>
          <p className={cn("mt-2 text-xs", blocked ? "text-warning" : "text-fg-subtle")}>
            {videoCost
              ? videoCost.reason ?? (videoCost.allowed ? `Uses about ${videoCost.required.toLocaleString()} credits.` : `Needs ${videoCost.required.toLocaleString()} credits; you have ${videoCost.balance.toLocaleString()}.`)
              : "Uses Zenvi credits."}
          </p>
          <Button className="mt-2 w-full" variant="primary" loading={videoBusy} disabled={!prompt.trim() || blocked} onClick={() => void runVideo()}>
            {videoBusy ? `Generating… ${elapsed}s` : "Generate video"}
          </Button>
        </Card>

        <Card icon={<Mic size={15} />} title="Voiceover" hint="Narration from text, placed at the playhead.">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Every great edit starts with a single cut."
            aria-label="Voiceover text"
            className="w-full resize-none rounded-md border border-line-strong bg-white/[0.03] px-2.5 py-2 text-sm text-fg outline-none placeholder:text-fg-faint focus:border-accent"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select<TtsVoice> ariaLabel="Voice" value={voice} onChange={setVoice} options={TTS_VOICES.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))} className="w-full" />
            <Select<number>
              ariaLabel="Speed"
              value={speed}
              onChange={setSpeed}
              options={[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((s) => ({ value: s, label: `${s}×` }))}
              className="w-full"
            />
          </div>
          <p className="mt-2 text-xs text-fg-subtle">Uses a few credits per request.</p>
          <Button className="mt-2 w-full" variant="secondary" loading={ttsBusy} disabled={!text.trim()} onClick={() => void runTts()}>
            Generate voiceover
          </Button>
        </Card>
      </div>
    </div>
  );
}
