/**
 * Render workers: with `ZENVI_RENDER_QUEUE` set, the service posts each new
 * render job on an Azure Storage queue instead of rendering it in its own
 * process, and Azure Container Apps starts a job execution per message
 * (`scripts/azure/render-jobs.sh`). That execution (`render-job.ts`) renders
 * with its own CPUs and memory, so renders neither slow nor endanger the
 * container that answers requests.
 *
 * The renders table stays the record of every job; a message only wakes a
 * worker. Claims are ETag-checked, so a duplicate message renders nothing
 * twice, and a job no worker claims in time renders in the service as before
 * (`RenderService.recover`).
 */

import { QueueClient } from "@azure/storage-queue";

/** Which job a worker should render. */
export interface RenderTicket {
  userId: string;
  renderId: string;
}

export type RenderDispatch = (ticket: RenderTicket) => Promise<void>;

export function renderQueue(connectionString: string, name: string): QueueClient {
  return new QueueClient(connectionString, name);
}

export function queueDispatch(queue: QueueClient): RenderDispatch {
  return async (ticket) => {
    await queue.sendMessage(JSON.stringify({ userId: ticket.userId, renderId: ticket.renderId }));
  };
}

/** The ticket in a queue message, or null when the message is not one. */
export function parseTicket(text: string): RenderTicket | null {
  try {
    const value = JSON.parse(text) as Partial<RenderTicket>;
    if (typeof value.userId === "string" && value.userId !== "" && typeof value.renderId === "string" && /^r_[A-Za-z0-9]+$/.test(value.renderId)) {
      return { userId: value.userId, renderId: value.renderId };
    }
  } catch {
    // Not JSON: not ours.
  }
  return null;
}
