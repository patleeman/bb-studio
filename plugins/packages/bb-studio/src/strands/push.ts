// One phone push when a strand turns "needs you" (engineering plan, phase 4),
// in place of the old task hand-off push (BB_LOOP).
//
// A check runs a little after anything that can make a strand need the user
// (a BB question or approval, a worker going idle or failing, a Tool Gateway
// request) and every few minutes as a fallback. It reads each Bot's overview
// and pushes once for each strand that is "needs you" now and wasn't at the
// last check. A strand that stops needing the user can push again the next
// time it turns. What it pushed is kept across restarts; the very first check
// only records what already needs the user, so an update never floods the
// phone.
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
  overview(botId: string): Promise<{ conversations: OverviewConversation[] }>;
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

/** What to push for a strand that turned "needs you", or null when the phone hears of it otherwise or not at all. */
export async function pushFor(strand: StrandView, conversation: Pick<OverviewConversation, "threadId" | "title">, deps: Pick<StrandPushDeps, "bbPushesAsks" | "startedByAnotherThread">): Promise<{ body: string; threadId: string } | null> {
  const ask: StrandAsk | undefined = strand.asks[0];
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
    this.running = this.run().catch((error: unknown) => this.deps.log?.(`Strands push: ${error instanceof Error ? error.message : String(error)}`)).finally(() => { this.running = null; });
    await this.running;
    if (this.again && !this.disposed) { this.again = false; await this.check(); }
  }

  private async run(): Promise<void> {
    const before = await this.deps.load();
    const seen = new Set(before ?? []);
    const now = new Set<string>();
    const sends: { botId: string; strand: StrandView; conversation: OverviewConversation }[] = [];
    for (const bot of this.deps.bots()) {
      const { conversations } = await this.deps.overview(bot.id);
      for (const conversation of conversations) {
        for (const strand of conversation.strands) {
          if (strand.state !== "needs-you") continue;
          now.add(strand.id);
          if (!seen.has(strand.id)) sends.push({ botId: bot.id, strand, conversation });
        }
      }
    }
    await this.deps.save([...now]);
    // The first check only learns what already needs the user.
    if (before === null) return;
    for (const { botId, strand, conversation } of sends) {
      const push = await pushFor(strand, conversation, this.deps);
      if (!push) continue;
      try {
        await this.deps.notify({
          title: `${strand.title} · ${conversation.title}`.slice(0, 120), body: push.body, kind: "needs-you",
          threadId: push.threadId, conversationId: conversation.threadId, botId,
          projectId: (await this.deps.projectOf(conversation.threadId).catch(() => null)) || this.deps.defaultProjectId,
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
