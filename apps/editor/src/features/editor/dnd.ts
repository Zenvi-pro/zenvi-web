import type { DragEvent as ReactDragEvent } from "react";

/**
 * Drag and drop between editor panels and the timeline. The payload is also
 * kept in memory because `dataTransfer.getData` is unreadable during
 * `dragover`, and the timeline needs it to draw a drop preview.
 */

export const DND_TYPES = {
  files: "application/x-zenvi-files",
  effect: "application/x-zenvi-effect",
  transition: "application/x-zenvi-transition",
} as const;

export type DragPayload =
  | { kind: "files"; fileIds: string[]; durations: number[] }
  | { kind: "effect"; className: string; name: string }
  | { kind: "transition"; maskId: string; name: string };

let current: DragPayload | null = null;

export function beginDrag(event: DragEvent | ReactDragEvent, payload: DragPayload, preview?: HTMLElement | null): void {
  current = payload;
  const type = DND_TYPES[payload.kind];
  event.dataTransfer?.setData(type, JSON.stringify(payload));
  event.dataTransfer?.setData("text/plain", payload.kind === "files" ? payload.fileIds.join(",") : payload.kind === "effect" ? payload.className : payload.maskId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  if (preview && event.dataTransfer) event.dataTransfer.setDragImage(preview, 16, 16);
}

export function endDrag(): void {
  current = null;
}

export function activeDrag(): DragPayload | null {
  return current;
}

/** Read a payload on drop (falls back to the in-memory one). */
export function readDrop(event: DragEvent | ReactDragEvent): DragPayload | null {
  for (const type of Object.values(DND_TYPES)) {
    const raw = event.dataTransfer?.getData(type);
    if (raw) {
      try {
        return JSON.parse(raw) as DragPayload;
      } catch {
        return current;
      }
    }
  }
  return current;
}

export function isEditorDrag(event: DragEvent | ReactDragEvent): boolean {
  const types = event.dataTransfer?.types ?? [];
  return Object.values(DND_TYPES).some((t) => types.includes(t));
}

export function isFileDrag(event: DragEvent | ReactDragEvent): boolean {
  return (event.dataTransfer?.types ?? []).includes("Files");
}
