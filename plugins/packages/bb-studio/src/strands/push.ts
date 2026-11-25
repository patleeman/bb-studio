// One phone push when a strand turns "needs you" (engineering plan, phase 4),
// in place of the old task hand-off push (BB_LOOP).
//
// A check runs a little after anything that can make a strand need the user
// (a BB question or approval, a worker going idle or failing, a Tool Gateway
// request) and every few minutes as a fallback. It reads, live, each Bot's
// conversations active in the last day that have a strand not marked done
// (StrandService.needsYouCheck), and pushes once for each strand that is
// "needs you" now and wasn't at the last check. What it knew about the
// conversations it didn't read stays as it was, so one coming back into the
// window doesn't push again for the same strand. A strand that stops needing
// the user can push again the next time it turns. What it pushed is kept across restarts; the very first check
// only records what already needs the user, so an update never floods the
// phone.
//
// A strand that needs the user only because a reply asks them something
// isn't pushed here: that reply's own push covers it (Main's in
// src/main-push.ts, BB's checked by Studio Mobile; a reply that needs the user
// pushes even in a turn another thread started), unless the user read it or
// muted the thread. It doesn't count as pushed, so a real ask on the same
// strand later still pushes, and its body never repeats a reply's ask.
//
// The push-flood rules still hold:
// - no push for an ask BB pushes itself: a question or approval in a thread
//   BB shows (Main and workers' threads aside, BB pushes those); a Tool
//   Gateway request, an area's item that needs the user and a conversation's
//   flag (bot_needs_you) always push;
// - no push for an ask in a turn another thread started (a worker's or a
//   runner's report waking the conversation);
// - the push is a plain "needs-you" push about the conversation, so Studio
//   Mobile holds it while the user is at the desk and keeps it to one per
//   conversation per few minutes; the phone shows it quietly in the
//   foreground like any push that isn't an ask category.
import type { OverviewConversation, StrandAsk, StrandView } from "./contract";

export const STRAND_PUSH_DELAY_MS = 2_000;
export const STRAND_PUSH_EVERY_MS = 3 * 60_000;
export const STRAND_PUSH_KEY = "strands.needsYouPushed";
/** Only conversations with activity this recent are read for the push. */
export const STRAND_PUSH_ACTIVE_MS = 24 * 60 * 60_000;
const BODY_MAX = 200;

export type StrandPushInput = {
  title: string;
  body: string;
  kind: "needs-you";
  threadId: string;
  conversationId: string;
  botId: string;
  projectId: string;
};

export interface StrandPushDeps {
  bots(): { id: string; name: string }[];
  /** The conversations to read (active in the last STRAND_PUSH_ACTIVE_MS, with a strand not marked done), read live; `checked` names them. */
  overview(botId: string): Promise<{ conversations: OverviewConversation[]; checked?: string[] }>;
  /** The conversation a strand is in, to keep what the check knew about a conversation it didn't read. */
  strandThread?(strandId: string): string | null;
  /** Whether BB itself pushes a pending question or approval in this thread (a thread BB shows, not hidden). */
  bbPushesAsks(threadId: string): Promise<boolean>;
  /** Whether the conversation's latest turn was started by another thread (fromAnotherThread on its request). */
  startedByAnotherThread(threadId: string): Promise<boolean>;
  projectOf(threadId: string): Promise<string | null>;
  notify(input: StrandPushInput): Promise<void>;
  /** The strands pushed for and still needing the user, kept across restarts; null before the first check. */
  load(): Promise<string[] | null>;
  save(ids: string[]): Promise<void>;
  defaultProjectId: string;
  /** Called after a push: Main's own reply push stays quiet for a few minutes after it (src/main-push.ts). */
  pushed?(botId: string): void;
  log?(message: string): void;
  delayMs?: number;
}

/** A strand that needs the user only for replies that ask them something (no BB ask, no worker waiting on them). */
export function onlyReplies(strand: Pick<StrandView, "asks" | "workers">): boolean {
  return strand.asks.length > 0 && strand.asks.every((ask) => ask.kind === "reply") && !strand.workers.some((worker) => worker.status === "needs-you");
}

/** What to push for a strand that turned "needs you", or null when the phone hears of it otherwise or not at all. */
export async function pushFor(strand: StrandView, conversation: Pick<OverviewConversation, "threadId" | "title">, deps: Pick<StrandPushDeps, "bbPushesAsks" | "startedByAnotherThread">): Promise<{ body: string; threadId: string } | null> {
  // A reply's ask pushed with the reply itself: the strand's push tells the rest.
  const ask: StrandAsk | undefined = strand.asks.find((each) => each.kind !== "reply");
  if (ask && (ask.kind === "question" || ask.kind === "approval")) {
    if (await deps.bbPushesAsks(ask.threadId)) return null;
    if (ask.threadId === conversation.threadId && await deps.startedByAnotherThread(conversation.threadId)) return null;
  }
  const body = ask?.label ?? strand.detail ?? "Needs you";
  return { body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX - 1).trimEnd()}…` : body, threadId: conversation.threadId };
}

export class StrandPushes {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private disposed = false;

  constructor(private readonly deps: StrandPushDeps) {}

  /** Something may have made a strand need the user: check soon. */
  poke(): void {
    if (this.disposed || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.check(); }, this.deps.delayMs ?? STRAND_PUSH_DELAY_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** One check now; a check asked for while one runs follows it. */
  async check(): Promise<void> {
    if (this.disposed) return;
    if (this.running) { this.again = true; return this.running; }
    this.running = this.run().catch((error: unknown) => {
      if (!this.disposed) this.deps.log?.(`Strands push: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => { this.running = null; });
    await this.running;
    if (this.again && !this.disposed) { this.again = false; await this.check(); }
  }

  private async run(): Promise<void> {
    if (this.disposed) return;
    const before = await this.deps.load();
    if (this.disposed) return;
    const seen = new Set(before ?? []);
    const now = new Set<string>();
    const sends: { botId: string; strand: StrandView; conversation: OverviewConversation }[] = [];
    const checked = new Set<string>();
    let knowsChecked = true;
    for (const bot of this.deps.bots()) {
      if (this.disposed) return;
      const { conversations, checked: read } = await this.deps.overview(bot.id);
      if (this.disposed) return;
      if (!read) knowsChecked = false;
      for (const threadId of read ?? []) checked.add(threadId);
      for (const conversation of conversations) {
        for (const strand of conversation.strands) {
          if (strand.state !== "needs-you" || onlyReplies(strand)) continue;
          now.add(strand.id);
          if (!seen.has(strand.id)) sends.push({ botId: bot.id, strand, conversation });
        }
      }
    }
    // A strand pushed for in a conversation this check didn't read stays known.
    if (knowsChecked && this.deps.strandThread) {
      for (const id of seen) {
        if (now.has(id)) continue;
        const thread = this.deps.strandThread(id);
        if (thread && !checked.has(thread)) now.add(id);
      }
    }
    if (this.disposed) return;
    await this.deps.save([...now]);
    // Once saved, finish sending every claimed push even if dispose() lands mid-flight
    // (a reloaded instance reads the saved list and would otherwise skip them).
    // The first check only learns what already needs the user.
    if (before === null) return;
    for (const { botId, strand, conversation } of sends) {
      const push = await pushFor(strand, conversation, this.deps);
      if (!push) continue;
      try {
        const projectId = (await this.deps.projectOf(conversation.threadId).catch(() => null)) || this.deps.defaultProjectId;
        await this.deps.notify({
          title: `${strand.title} · ${conversation.title}`.slice(0, 120), body: push.body, kind: "needs-you",
          threadId: push.threadId, conversationId: conversation.threadId, botId,
          projectId,
        });
        this.deps.pushed?.(botId);
      } catch (error) {
        this.deps.log?.(`Strands push for ${strand.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
