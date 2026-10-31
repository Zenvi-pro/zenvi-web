import { Music, Pause, Play, Plus, Search, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { SearchInput } from "@/ui/Input";
import { Spinner } from "@/ui/Spinner";
import { useSession } from "../session/context";
import { PanelEmpty, PanelHeader, Segmented } from "./PanelChrome";
import { importStock, pexelsPreviewLink, searchFreesound, searchPexels, type FreesoundSound, type PexelsVideo, type StockItem } from "./stock";

type Source = "video" | "audio";

const SUGGESTIONS: Record<Source, string[]> = {
  video: ["city at night", "ocean waves", "forest", "people working", "drone mountains", "coffee"],
  audio: ["upbeat", "ambient", "cinematic", "whoosh", "applause", "rain"],
};

/** An import under way: the fraction downloaded (null until the size is known), and how to stop it. */
interface Importing {
  fraction: number | null;
  controller: AbortController;
}

function percent(job: Importing): string {
  return job.fraction === null ? "" : `${Math.round(job.fraction * 100)}%`;
}

function importingLabel(job: Importing): string {
  return job.fraction === null ? "Importing" : `Importing ${percent(job)}`;
}

function VideoResult({ video, onImport, job }: { video: PexelsVideo; onImport: (toTimeline: boolean) => void; job: Importing | undefined }) {
  const busy = job !== undefined;
  const [hover, setHover] = useState(false);
  const preview = hover ? pexelsPreviewLink(video) : "";
  return (
    <div className="group min-w-0" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        onClick={() => (job ? job.controller.abort() : onImport(false))}
        title={job ? "Cancel import" : "Import to Project Files"}
        className="relative block aspect-video w-full overflow-hidden rounded-md bg-elevated outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <img src={video.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        {preview ? <video src={preview} muted autoPlay loop playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
        <span className="absolute bottom-1 right-1 rounded-[3px] bg-black/70 px-1 text-[10px] font-medium tnum text-fg-muted">{formatDuration(video.duration)}</span>
        {job ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50" role="status" aria-label={importingLabel(job)}>
            <Spinner size={16} className="text-fg" />
            <span className="text-2xs tnum text-fg">{percent(job)}</span>
          </span>
        ) : null}
      </button>
      <div className="mt-1 flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-2xs text-fg-subtle" title={`Video by ${video.user_name} on Pexels`}>
          {video.user_name || "Pexels"}
        </p>
        <button
          type="button"
          aria-label="Add to timeline"
          title="Add to timeline"
          disabled={busy}
          onClick={() => onImport(true)}
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-fg-subtle opacity-0 outline-none hover:bg-white/[0.08] hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

function AudioResult({ sound, playing, onToggle, onImport, job }: { sound: FreesoundSound; playing: boolean; onToggle: () => void; onImport: (toTimeline: boolean) => void; job: Importing | undefined }) {
  return (
    <div className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.04]">
      <button
        type="button"
        aria-label={playing ? `Pause ${sound.name}` : `Play ${sound.name}`}
        onClick={onToggle}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-fg outline-none hover:bg-white/[0.14] focus-visible:ring-2 focus-visible:ring-accent"
      >
        {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg">{sound.name}</p>
        <div className="flex items-center gap-2">
          {sound.images.waveform_m ? <img src={sound.images.waveform_m} alt="" loading="lazy" className="h-4 min-w-0 flex-1 object-fill opacity-50 invert" /> : null}
          <span className="shrink-0 text-2xs tnum text-fg-subtle">{formatDuration(sound.duration)}</span>
        </div>
      </div>
      {job ? (
        <button
          type="button"
          aria-label={`${importingLabel(job)}, cancel`}
          title="Cancel import"
          onClick={() => job.controller.abort()}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-1 text-2xs tnum text-fg-subtle outline-none hover:bg-white/[0.08] hover:text-fg"
        >
          <Spinner size={14} />
          {percent(job)}
        </button>
      ) : (
        <div className="flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button size="xs" variant="ghost" onClick={() => onImport(false)}>
            Import
          </Button>
          <button
            type="button"
            aria-label="Add to timeline"
            title="Add to timeline"
            onClick={() => onImport(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-subtle outline-none hover:bg-white/[0.08] hover:text-fg"
          >
            <Plus size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export function StockPanel() {
  const session = useSession();
  const [source, setSource] = useState<Source>("video");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [videos, setVideos] = useState<PexelsVideo[] | null>(null);
  const [sounds, setSounds] = useState<FreesoundSound[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ReadonlyMap<number, Importing>>(new Map());
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!submitted) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const run = source === "video" ? searchPexels(submitted, controller.signal).then(setVideos) : searchFreesound(submitted, controller.signal).then(setSounds);
    run
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [submitted, source]);

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = (sound: FreesoundSound) => {
    if (playing === sound.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const el = new Audio(sound.previews.lq_mp3 || sound.previews.hq_mp3);
    el.onended = () => setPlaying(null);
    void el.play().catch(() => setPlaying(null));
    audio.current = el;
    setPlaying(sound.id);
  };

  const doImport = async (id: number, item: StockItem, toTimeline: boolean) => {
    const controller = new AbortController();
    const update = (fraction: number | null) => setJobs((m) => (m.has(id) ? new Map(m).set(id, { fraction, controller }) : m));
    setJobs((m) => new Map(m).set(id, { fraction: null, controller }));
    try {
      await importStock(session, item, toTimeline ? "end" : null, { onProgress: update, signal: controller.signal });
    } finally {
      setJobs((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      });
    }
  };

  const search = (q: string) => {
    setQuery(q);
    setSubmitted(q.trim());
  };

  const results = source === "video" ? videos : sounds;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Stock" />
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-2.5">
        <Segmented<Source>
          label="Stock type"
          value={source}
          onChange={(v) => {
            setSource(v);
            if (submitted) setSubmitted(submitted);
          }}
          options={[
            { value: "video", label: "Video" },
            { value: "audio", label: "Music & sound" },
          ]}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
        >
          <SearchInput value={query} onValueChange={setQuery} placeholder={source === "video" ? "Search Pexels videos" : "Search Freesound"} aria-label="Search stock media" />
        </form>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="grid h-32 place-items-center text-fg-subtle">
            <Spinner />
          </div>
        ) : error ? (
          <p className="mx-1 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
        ) : !submitted || !results ? (
          <PanelEmpty icon={source === "video" ? <Video size={22} /> : <Music size={22} />} title={source === "video" ? "Free stock video from Pexels" : "Music and sound effects from Freesound"} body="Search, preview, then import. Downloads stay in this browser.">
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS[source].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => search(s)}
                  className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-1 text-xs text-fg-muted outline-none hover:border-line-bright hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Search size={11} /> {s}
                </button>
              ))}
            </div>
          </PanelEmpty>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-xs text-fg-subtle">Nothing found for “{submitted}”.</p>
        ) : source === "video" ? (
          <div className="grid grid-cols-2 gap-2 px-1">
            {(videos ?? []).map((v) => (
              <VideoResult key={v.id} video={v} job={jobs.get(v.id)} onImport={(t) => void doImport(v.id, { kind: "pexels", video: v }, t)} />
            ))}
          </div>
        ) : (
          <div className={cn("space-y-0.5")}>
            {(sounds ?? []).map((s) => (
              <AudioResult key={s.id} sound={s} playing={playing === s.id} job={jobs.get(s.id)} onToggle={() => toggle(s)} onImport={(t) => void doImport(s.id, { kind: "freesound", sound: s }, t)} />
            ))}
          </div>
        )}
        {submitted && results?.length ? (
          <p className="mt-3 px-1 text-center text-2xs text-fg-faint">{source === "video" ? "Videos from Pexels. Free to use; credit the creator when you can." : "Sounds from Freesound. Check each sound's license before publishing."}</p>
        ) : null}
      </div>
    </div>
  );
}
