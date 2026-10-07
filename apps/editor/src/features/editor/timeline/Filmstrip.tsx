import type { Clip } from "@zenvi/engine";
import { useEffect, useSyncExternalStore } from "react";
import { useProjectSelector, useSession } from "../session/context";
import { nearestIndex } from "../session/previews";

export interface FilmstripProps {
  fileId: string;
  clip: Clip;
  pxPerSecond: number;
  height: number;
  /** Clip-local px range in view. */
  visibleFrom: number;
  visibleTo: number;
}

/** Thumbnail tiles for the visible part of a clip, from the file's sprite. */
export function Filmstrip({ fileId, clip, pxPerSecond, height, visibleFrom, visibleTo }: FilmstripProps) {
  const session = useSession();
  const previews = session.previews;
  const sprite = useSyncExternalStore(
    (l) => previews.subscribe(l),
    () => previews.sprite(fileId),
  );
  const file = useProjectSelector((p) => p.files.find((f) => f.id === fileId), [fileId]);
  const status = useSyncExternalStore(
    (l) => session.media.status.subscribe(l),
    () => session.media.status.getState()[fileId]?.status,
  );

  useEffect(() => {
    if (!file || status !== "ready") return;
    previews.requestSprite(fileId, Number(file.duration) || 0, Boolean(file.has_single_image) || file.media_type === "image");
  }, [file, fileId, previews, status]);

  if (!sprite || height < 12) return null;
  const tileHeight = height;
  const tileWidth = Math.max(8, Math.round((sprite.tileWidth / sprite.tileHeight) * tileHeight));
  const first = Math.max(0, Math.floor(visibleFrom / tileWidth));
  const last = Math.ceil(visibleTo / tileWidth);
  const tiles: { x: number; index: number }[] = [];
  for (let i = first; i <= last && tiles.length < 400; i += 1) {
    const x = i * tileWidth;
    const t = clip.start + (x + tileWidth / 2) / pxPerSecond;
    tiles.push({ x, index: sprite.times.length === 1 ? 0 : nearestIndex(sprite.times, t) });
  }
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-90">
      {tiles.map((tile) => (
        <div
          key={tile.x}
          className="absolute top-0"
          style={{
            left: tile.x,
            width: tileWidth,
            height: tileHeight,
            backgroundImage: `url(${sprite.url})`,
            backgroundSize: `${sprite.times.length * tileWidth}px ${tileHeight}px`,
            backgroundPosition: `${-tile.index * tileWidth}px 0`,
          }}
        />
      ))}
    </div>
  );
}
