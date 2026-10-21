// Follows working threads' events and passes on what each agent is doing
// (src/server/activity.ts). A thread is followed while it works; it stops
// once the thread has gone idle and its last events are read.
import { activitiesFrom, type Activity } from "./activity";

type Event = { seq: number | string; type: string; data?: unknown };
/** BB serves at most 100 events a page. */
const PAGE = 100;

export class ThreadWatcher {
  private readonly loops = new Map<string, { stop: boolean }>();

  constructor(private readonly options: {
    /** A page of a thread's events: after `afterSeq` ascending, or the latest with order "desc". */
    events(args: { threadId: string; afterSeq?: string; order?: "asc" | "desc"; limit: string }): Promise<{ events: Event[] }>;
    /** The thread's working folder, for relative paths in its commands. */
    threadPath(threadId: string): Promise<string | null>;
    /** The thread's status: following ends once it isn't working. */
    status(threadId: string): Promise<string>;
    onActivity(threadId: string, activity: Activity): void;
    /** Problems reading a thread, and when following stops. */
    log?(message: string): void;
    pollMs?: number;
  }) {}

  watching(threadId: string): boolean {
    return this.loops.has(threadId);
  }

  /** Starts following a thread from its latest event; no-op when already following. */
  watch(threadId: string): void {
    if (this.loops.has(threadId)) return;
    const loop = { stop: false };
    this.loops.set(threadId, loop);
    void this.follow(threadId, loop).finally(() => { if (this.loops.get(threadId) === loop) this.loops.delete(threadId); });
  }

  dispose(): void {
    for (const loop of this.loops.values()) loop.stop = true;
    this.loops.clear();
  }

  private async follow(threadId: string, loop: { stop: boolean }): Promise<void> {
    const pollMs = this.options.pollMs ?? 700;
    // One line per problem, not one per poll.
    let said = "";
    const log = (message: string) => { if (message !== said) { said = message; this.options.log?.(message); } };
    const latest = await this.options.events({ threadId, order: "desc", limit: "1" }).catch((error) => { log(`thread ${threadId}: couldn't read events: ${String(error)}`); return { events: [] as Event[] }; });
    let after = String(latest.events[0]?.seq ?? 0);
    const base = await this.options.threadPath(threadId).catch(() => null);
    let quiet = 0;
    while (!loop.stop) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      const page = await this.options.events({ threadId, afterSeq: after, order: "asc", limit: String(PAGE) }).catch((error) => { log(`thread ${threadId}: couldn't read events: ${String(error)}`); return { events: [] as Event[] }; });
      for (const event of page.events) {
        after = String(event.seq);
        for (const activity of activitiesFrom(event as never, base)) this.options.onActivity(threadId, activity);
      }
      if (page.events.length) { quiet = 0; continue; }
      // Nothing new: stop once the thread is no longer working (after one more look).
      const status = await this.options.status(threadId).catch(() => "idle");
      if (status === "active" || status === "starting" || status === "running") quiet = 0;
      else if (++quiet >= 2) { log(`thread ${threadId}: stopped following (status ${status})`); return; }
    }
  }
}
