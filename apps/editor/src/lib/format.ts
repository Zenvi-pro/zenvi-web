/** Display formatting (UI only; no timeline semantics here). */

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** 0:42, 12:05, 1:02:03 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** "1080p", "4K", "1080×1920" — a short label for a frame size. */
export function formatResolution(width: number, height: number): string {
  const short = Math.min(width, height);
  const landscape = width >= height;
  if (landscape && width === 3840 && height === 2160) return "4K";
  if (landscape && width === 7680 && height === 4320) return "8K";
  if (landscape && [480, 576, 720, 1080, 1440, 2160].includes(height) && Math.abs(width / height - 16 / 9) < 0.02) return `${short}p`;
  return `${width}×${height}`;
}

export function formatFps(fps: { num: number; den: number }): string {
  const value = fps.num / fps.den;
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)} fps`;
}
