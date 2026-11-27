// Phone pushes for a Bot's Main. Main is hidden in BB, and BB's
// push-notifications sends nothing for a hidden thread, so Studio pushes
// Main's replies meant for the user itself: a real message, a work card or a
// loop, the morning card. Not a quiet pass, an approval card alone (its own
// push covers it), a cache keepalive, a reply the user already read, or a
// Main whose own BB level is input-only or muted, nor Main answering another
// thread (a runner's or worker's report, BB's notice that a child finished)
// unless the answer carries a card that needs the user. Studio Mobile groups them:
// one push per conversation per few minutes (push-window.ts there).
//
// Where strands tag replies (src/strands/reply.ts), Jev's tag decides first:
// a status reply doesn't push, and one that needs the user pushes with its
// ask as the body, even when another thread started the turn or a task push
// just went out (an ask is never swallowed). The tag is read first (up to 20
// seconds), then whether the user read the reply or muted Main, so a reply
// read during the wait doesn't push. Each push is for its own turn's reply,
// and one turn pushes once. When the tag isn't known, it pushes as before.
import { isPassOutput } from "./kit/silent";
import { isPingRequest } from "./bot-cache";

export const MAIN_PUSH_DELAY_MS = 2_000;
export const TASK_PUSH_QUIET_MS = 3 * 60_000;
const APPROVAL_CARD = /^(?:\s*::approval\{[^}\n]*\}\s*)+$/u;
const DIRECTIVE_LINE = /^\s{0,3}::[A-Za-z][\w-]*(?:\[[^\]]*\])?(?:\{.*\})?\s*$/u;
const PREVIEW_MAX = 300;

/** A final reply with something for the user to read. */
export function isUserFacing(text: string | null | undefined): text is string {
  return typeof text === "string" && text.trim() !== "" && !isPassOutput(text) && !APPROVAL_CARD.test(text);
}

/** The push body: the reply's first lines as plain text; a card stands in for a reply that is only cards. */
export function previewOf(text: string): string {
  const joined = plainPreview(text);
  if (joined) return joined;
  if (/::loop\{/u.test(text)) return "New on your list";
  if (/::work\{/u.test(text)) return "A work card needs you";
  return "New message";
}

export function cardsIn(text: string): { kind: "work" | "loop"; id: string }[] {
  return [...text.matchAll(/::(work|loop)\{[^}\n]*\bid="([^"]+)"[^}\n]*\}/gu)].map((m) => ({ kind: m[1] as "work" | "loop", id: m[2]! }));
}

function plainPreview(text: string): string {
  const lines: string[] = [];
  let fenced = false;
  for (const raw of text.split(/\r?\n/u)) {
    if (/^\s*(```|~~~)/u.test(raw)) { fenced = !fenced; continue; }
    if (fenced || DIRECTIVE_LINE.test(raw) || /^\s{0,3}\|/u.test(raw) || /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/u.test(raw)) continue;
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/u, "")
      .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/gu, "$1")
      .replace(/(\*\*|__|`|~~)/gu, "")
      .trim();
    if (line) lines.push(line);
    if (lines.join(" · ").length >= PREVIEW_MAX) break;
  }
  const joined = lines.join(" · ");
  return joined.length > PREVIEW_MAX ? `${joined.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : joined;
}

const THREAD_HEADER = /^\s*\[bb message from thread:[^\]\n]*\]/u;

/** A turn another thread started: a message from it, or BB's notice that a child thread completed, failed or stopped. */
export function fromAnotherThread(request: unknown): boolean {
  if (!request || typeof request !== "object") return false;
  const data = request as { senderThreadId?: string | null; systemMessageKind?: string; input?: { type?: string; text?: string }[] };
  if (data.senderThreadId) return true;
  if (typeof data.systemMessageKind === "string" && data.systemMessageKind.startsWith("child-")) return true;
  const first = (Array.isArray(data.input) ? data.input : []).find((part) => part.type === "text" && typeof part.text === "string")?.text ?? "";
  return THREAD_HEADER.test(first);
}

type Thread = { id: string; visibility?: string; projectId?: string | null; lastReadAt?: number | null; latestAttentionAt?: number };
export type MainPushInput = { title: string; body: string; kind: "turn-finished"; threadId: string; projectId: string; botId: string; conversationId: string };

export interface MainPushDeps {
  /** The Bot whose Main this thread is, or null. */
  mainOf(threadId: string): { botId: string; name: string } | null;
  thread(threadId: string): Promise<Thread | null>;
  /** The thread's latest client/turn/requested data. */
  lastRequest(threadId: string): Promise<unknown>;
  /** Whether BB's level for the thread lets a finished turn through (src/push-levels.ts). */
  allowed(threadId: string): Promise<boolean>;
  notify(input: MainPushInput): Promise<void>;
  needsUser?(card: { kind: "work" | "loop"; id: string }): boolean;
  pushedTaskSince?(botId: string, since: number): boolean;
  /** The seq of the message that started the thread's newest turn (src/strands/service.ts newestRequest). */
  lastRequestSeq?(threadId: string): Promise<number | null>;
  /** The tag of the reply of the turn that `requestSeq` started (src/strands/service.ts replyPush): push with its ask, stay quiet, or unknown. */
  replyTag?(threadId: string, requestSeq: number | null): Promise<{ decision: "push" | "quiet" | "unknown"; ask: string | null }>;
  defaultProjectId: string;
  delayMs?: number;
  log?(message: string): void;
}

export class MainPushes {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: MainPushDeps) {}

  /** BB's thread.idle. */
  idle(event: { thread: Thread; lastAssistantText: string | null; experimental_quiet?: boolean }): void {
    const { thread, lastAssistantText } = event;
    if (event.experimental_quiet === true || thread.visibility !== "hidden" || !isUserFacing(lastAssistantText)) return;
    const bot = this.deps.mainOf(thread.id);
    if (!bot) return;
    const pending = this.timers.get(thread.id);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      this.timers.delete(thread.id);
      void this.send(thread.id, bot, lastAssistantText).catch((error: unknown) => this.deps.log?.(`Main push failed: ${error instanceof Error ? error.message : String(error)}`));
    }, this.deps.delayMs ?? MAIN_PUSH_DELAY_MS);
    timer.unref?.();
    this.timers.set(thread.id, timer);
  }

  /** The turn (its request seq) each thread last pushed for: one turn pushes once. */
  private readonly pushedTurn = new Map<string, number>();

  async send(threadId: string, bot: { botId: string; name: string }, reply: string): Promise<boolean> {
    const [first, request, requestSeq] = await Promise.all([
      this.deps.thread(threadId), this.deps.lastRequest(threadId).catch(() => null), this.deps.lastRequestSeq?.(threadId).catch(() => null) ?? Promise.resolve(null),
    ]);
    const unread = (thread: Thread | null) => !!thread && !((thread.lastReadAt ?? 0) >= (thread.latestAttentionAt ?? 0) && thread.latestAttentionAt !== undefined);
    if (!first || isPingRequest(request) || !unread(first)) return false;
    // Jev's tag first; then everything that can change while it was awaited.
    const tag = await this.deps.replyTag?.(threadId, requestSeq).catch(() => null) ?? null;
    if (tag?.decision === "quiet") return false;
    const thread = tag ? await this.deps.thread(threadId).catch(() => null) : first;
    if (!thread || !unread(thread) || !(await this.deps.allowed(threadId))) return false;
    // A reply that needs the user always pushes; the rest by the old rules.
    const asks = tag?.decision === "push";
    if (!asks) {
      if (fromAnotherThread(request)) {
        // Main answering a runner or a worker: only a card that needs the user is worth the phone.
        const cards = cardsIn(reply);
        if (!cards.length || !this.deps.needsUser || !cards.some((card) => this.deps.needsUser!(card))) return false;
      }
      const cards = plainPreview(reply) ? [] : cardsIn(reply);
      if (cards.length && this.deps.needsUser && !cards.some((card) => this.deps.needsUser!(card))) return false;
      if (this.deps.pushedTaskSince?.(bot.botId, Date.now() - TASK_PUSH_QUIET_MS)) return false;
    }
    if (requestSeq !== null) {
      if (this.pushedTurn.get(threadId) === requestSeq) return false;
      this.pushedTurn.set(threadId, requestSeq);
    }
    await this.deps.notify({
      title: bot.name, body: asks && tag?.ask ? tag.ask : previewOf(reply), kind: "turn-finished", threadId,
      projectId: thread.projectId || this.deps.defaultProjectId, botId: bot.botId, conversationId: threadId,
    });
    return true;
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
