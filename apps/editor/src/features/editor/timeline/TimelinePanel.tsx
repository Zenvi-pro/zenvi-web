import { TimelineBody } from "./TimelineBody";
import { TimelineToolbar } from "./TimelineToolbar";

export function TimelinePanel({ height }: { height: number }) {
  return (
    <section aria-label="Timeline" className="flex shrink-0 flex-col overflow-hidden bg-base" style={{ height }}>
      <TimelineToolbar />
      <TimelineBody />
    </section>
  );
}
