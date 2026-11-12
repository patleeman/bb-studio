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
import { approvalDirective, approvalReason, isWorkerApproval, shortApproval, type Interaction as ApprovalInteraction } from "./worker-approvals";

type Sdk = BbPluginApi["sdk"];
type Thread = { id: string; title?: string | null; titleFallback?: string | null; projectId?: string | null };
type Interaction = { id?: string; status?: string; payload?: { kind?: string; title?: string | null; questions?: { question?: string }[]; data?: { title?: string; questions?: { question?: string }[] } | null } | null };

/** A worker's approval (not a plan review): it goes to its conversation as a card (src/worker-approvals.ts). */
const asApproval = (interaction: Interaction): ApprovalInteraction | null => interaction.id && isWorkerApproval(interaction as ApprovalInteraction) ? interaction as ApprovalInteraction : null;

/** The Bot that owns a thread, and whether the thread is that Bot's own chat. */
export type NudgeOwner = { botId: string; botThreadId: string; active: boolean; self: boolean };

/** What the thread waits for, and the question's words when it has them. */
function waitsOn(interaction: Interaction): { what: string; detail: string | null } {
  const payload = interaction.payload ?? {};
  const question = payload.questions?.[0]?.question ?? payload.data?.questions?.[0]?.question ?? null;
  if (payload.kind === "approval") return { what: "an approval", detail: payload.title ?? null };
  return { what: "an answer", detail: question ?? payload.title ?? payload.data?.title ?? null };
}

/** One short line on why a conversation needs the user: the thread and what it waits on. */
export function nudgeReason(thread: Thread, interaction: Interaction): string {
  const approval = asApproval(interaction);
  if (approval) return approvalReason(approval);
  const title = thread.title || thread.titleFallback || "A worker";
  const { what, detail } = waitsOn(interaction);
  const words = detail?.trim().replace(/\s+/g, " ") ?? "";
  return words ? `${title}: ${words}` : `${title} is waiting on ${what}`;
}

/** The agent-only note to the Bot. */
export function nudgeNote(thread: Thread, interaction: Interaction): string {
  const title = (thread.title || thread.titleFallback || "Untitled thread").replace(/"/g, "'");
  const approval = asApproval(interaction);
  if (approval) {
    const link = thread.projectId ? `/projects/${thread.projectId}/threads/${thread.id}` : thread.id;
    return `Your worker "${title}" (${link}) is waiting for the user's approval: ${shortApproval(approval)}. Only the user can approve it, and it shows here as a card with Approve and Deny. Reply with exactly this line and nothing else:\n${approvalDirective(thread.id, approval.id)}`;
  }
  const { what, detail } = waitsOn(interaction);
  const link = thread.projectId ? `/projects/${thread.projectId}/threads/${thread.id}` : thread.id;
  // The question keeps its own ending ("?"); anything else gets a full stop.
  const words = detail?.trim().replace(/\s+/g, " ").slice(0, 200) ?? "";
  const said = words ? `: ${words}${/[.?!]$/.test(words) ? "" : "."}` : ".";
  return `Your thread "${title}" (${link}) is waiting on ${what}${said} If you can handle it, do (answer it in that thread) and reply exactly [PASS]. If only the user can, ask them in a line or two here, with its link; this conversation shows as needing them until the thread stops waiting.`;
}

export class BotNudges {
  constructor(private deps: {
    db: Database.Database; sdk: Sdk; owner(thread: Thread): Promise<NudgeOwner | null>; log?(message: string): void;
    /** The note went to the owner's conversation: it is raised there (src/bot-threads.ts needs-you). */
    raised?(thread: Thread, owner: NudgeOwner, interaction: Interaction): void;
    /** The thread stopped waiting: what it raised is over. */
    cleared?(threadId: string): void;
  }) {}

  /** A thread got a pending interaction: nudge its Bot, once per waiting episode. */
  async pending(thread: Thread, interaction: Interaction): Promise<boolean> {
    if (this.deps.db.prepare("SELECT 1 FROM bot_nudges WHERE thread_id = ?").get(thread.id)) return false;
    const owner = await this.deps.owner(thread);
    // The Bot's own chat: its question is already the Bot's badge. A paused or stopped Bot starts no work.
    if (!owner || owner.self) return false;
    if (!owner.active) {
      // Only the user can give an approval: it still marks the conversation, with no card.
      if (asApproval(interaction)) try { this.deps.raised?.(thread, owner, interaction); } catch { /* the mark is a convenience */ }
      return false;
    }
    // Claim the episode first: two interactions at once nudge once.
    if (!this.deps.db.prepare("INSERT OR IGNORE INTO bot_nudges (thread_id, bot_id, at) VALUES (?, ?, ?)").run(thread.id, owner.botId, Date.now()).changes) return false;
    try {
      await this.deps.sdk.threads.send({
        threadId: owner.botThreadId, mode: "auto", senderThreadId: thread.id,
        input: [{ type: "text", text: nudgeNote(thread, interaction), mentions: [], visibility: "agent-only" }],
      } as never);
      try { this.deps.raised?.(thread, owner, interaction); } catch { /* the mark is a convenience */ }
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
    if (interactions && !interactions.some((interaction) => interaction.status === "pending")) {
      this.deps.db.prepare("DELETE FROM bot_nudges WHERE thread_id = ?").run(threadId);
      try { this.deps.cleared?.(threadId); } catch { /* the mark is a convenience */ }
    }
  }
}
