// The Bot triages its threads' questions (docs/needs-you/REDO.md). BB's
// notice when a thread the Bot started stops on a question reads like the
// thread finished ("@thread … completed: Waiting for your vault selection"),
// and a Bot replying [PASS] to it left the question unseen. So when a thread a
// Bot owns starts waiting on an answer (interaction.pending), Studio sends the
// Bot one agent-only note: answer it, or ask the user in its chat.
//
// Once per waiting episode: bot_nudges holds the threads Studio nudged about.
// The row goes when the thread stops waiting (a turn starts or ends with no
// pending interaction), so the next question nudges again. Kept in the
// database, so a restart doesn't repeat a nudge.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";

type Sdk = BbPluginApi["sdk"];
type Thread = { id: string; title?: string | null; titleFallback?: string | null; projectId?: string | null };
type Interaction = { status?: string; payload?: { kind?: string; title?: string | null; questions?: { question?: string }[]; data?: { title?: string; questions?: { question?: string }[] } | null } | null };

/** The Bot that owns a thread, and whether the thread is that Bot's own chat. */
export type NudgeOwner = { botId: string; botThreadId: string; active: boolean; self: boolean };

/** What the thread waits for, and the question's words when it has them. */
function waitsOn(interaction: Interaction): { what: string; detail: string | null } {
  const payload = interaction.payload ?? {};
  const question = payload.questions?.[0]?.question ?? payload.data?.questions?.[0]?.question ?? null;
  if (payload.kind === "approval") return { what: "an approval", detail: payload.title ?? null };
  return { what: "an answer", detail: question ?? payload.title ?? payload.data?.title ?? null };
}

/** The agent-only note to the Bot. */
export function nudgeNote(thread: Thread, interaction: Interaction): string {
  const title = (thread.title || thread.titleFallback || "Untitled thread").replace(/"/g, "'");
  const { what, detail } = waitsOn(interaction);
  const link = thread.projectId ? `/projects/${thread.projectId}/threads/${thread.id}` : thread.id;
  // The question keeps its own ending ("?"); anything else gets a full stop.
  const words = detail?.trim().replace(/\s+/g, " ").slice(0, 200) ?? "";
  const said = words ? `: ${words}${/[.?!]$/.test(words) ? "" : "."}` : ".";
  return `Your thread "${title}" (${link}) is waiting on ${what}${said} If you can handle it, do (answer it in that thread) and reply exactly [PASS]. If only the user can, ask them in a line or two here, with its link.`;
}

export class BotNudges {
  constructor(private deps: { db: Database.Database; sdk: Sdk; owner(thread: Thread): Promise<NudgeOwner | null>; log?(message: string): void }) {}

  /** A thread got a pending interaction: nudge its Bot, once per waiting episode. */
  async pending(thread: Thread, interaction: Interaction): Promise<boolean> {
    if (this.deps.db.prepare("SELECT 1 FROM bot_nudges WHERE thread_id = ?").get(thread.id)) return false;
    const owner = await this.deps.owner(thread);
    // The Bot's own chat: its question is already the Bot's badge. A paused or stopped Bot starts no work.
    if (!owner || owner.self || !owner.active) return false;
    // Claim the episode first: two interactions at once nudge once.
    if (!this.deps.db.prepare("INSERT OR IGNORE INTO bot_nudges (thread_id, bot_id, at) VALUES (?, ?, ?)").run(thread.id, owner.botId, Date.now()).changes) return false;
    try {
      await this.deps.sdk.threads.send({
        threadId: owner.botThreadId, mode: "auto", senderThreadId: thread.id,
        input: [{ type: "text", text: nudgeNote(thread, interaction), mentions: [], visibility: "agent-only" }],
      } as never);
      return true;
    } catch (error) {
      // Not sent: the next pending interaction may try again.
      this.deps.db.prepare("DELETE FROM bot_nudges WHERE thread_id = ?").run(thread.id);
      this.deps.log?.(`Nudging the Bot about ${thread.id} failed: ${(error as Error)?.message ?? error}`);
      return false;
    }
  }

  /** A thread's turn started or ended: no pending interaction left, its waiting episode is over. */
  async settled(threadId: string): Promise<void> {
    if (!this.deps.db.prepare("SELECT 1 FROM bot_nudges WHERE thread_id = ?").get(threadId)) return;
    const interactions = await this.deps.sdk.threads.interactions.list({ threadId }).catch(() => null) as Interaction[] | null;
    if (interactions && !interactions.some((interaction) => interaction.status === "pending")) this.deps.db.prepare("DELETE FROM bot_nudges WHERE thread_id = ?").run(threadId);
  }
}
