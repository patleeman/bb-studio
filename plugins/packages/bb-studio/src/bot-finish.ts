// Finishing a conversation (plan page pg_ca4aba3141b2d2af, "Finishing a
// conversation"; mockup 6d). The conversation writes its own summary as a
// memory record with a link back, and Main gets the card:
//
// 1. Archiving a conversation (BB's Archive anywhere, iOS, or `bot_finish`)
//    sends one last turn INTO the conversation: write a summary of the
//    decisions, what was left open and what was made; save it with
//    memory_add (topic: the conversation, source: the conversation); call
//    bot_finish_done with it. Main and workers can't be finished; a
//    conversation that is working can't either (finish it when it's done).
// 2. bot_finish_done (also when the user asks for it in the chat) archives
//    the conversation in Studio (bot_threads.archived_at, finished_summary),
//    posts the summary to Main from the conversation with an agent-only note
//    that has the Bot answer with the `::finished{thread="…"}` card, and
//    sets Main's row to "Archived “<title>” · summary saved". BB's own
//    archive follows once the conversation's turn is over.
// 3. If the turn ends (or fails) without bot_finish_done, or nothing happens
//    for FINISH_TIMEOUT_MS, Studio finishes it with a summary built from the
//    conversation's last replies, and saves that to memory itself unless
//    the Bot already saved a record from this conversation.
// 4. A finished conversation is out of the sidebar; Search and the Library
//    still find it. It opens read-only with "Archived on <date>" and Reopen
//    (bot_reopen: back in the sidebar, unarchived in BB). Finished
//    conversations are kept indefinitely: nothing deletes them.
//
// The table `bot_finishes` keeps one row per conversation being finished or
// finished (state finishing | finished | reopened), so a restart picks up a
// pending one.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { BotThreads, ThreadFacts } from "./bot-threads";
import type { BotChange } from "./bot-signal";
import { memoryPath } from "./memory/shared";

type Sdk = BbPluginApi["sdk"];

/** How long a finish waits for bot_finish_done before Studio writes the summary itself. */
export const FINISH_TIMEOUT_MS = 10 * 60_000;
/** An idle within this of the request is the turn before the finish, not its own. */
const IDLE_GRACE_MS = 1_500;
const BUSY = new Set(["starting", "active", "stopping", "pending", "provisioning"]);

export type FinishState = "finishing" | "finished" | "reopened";

interface Row {
  thread_id: string; bot_id: string; title: string; state: string; requested_at: number; deadline_at: number;
  finished_at: number | null; via: string | null; bb_archive_pending: number;
}

const quietArchives = new Set<string>();

export async function archiveQuietly(threadId: string, archive: () => Promise<unknown>): Promise<void> {
  quietArchives.add(threadId);
  try {
    await archive();
  } catch (error) {
    quietArchives.delete(threadId);
    throw error;
  }
}

/** Whether a conversation is being finished. */
export function isFinishing(db: Database.Database, threadId: string): boolean {
  return !!db.prepare("SELECT 1 FROM bot_finishes WHERE thread_id = ? AND state = 'finishing'").get(threadId);
}

/** The topic a conversation's summary is saved under: its title. */
export function finishTopic(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 60).trim() || "Conversation";
}

/** The agent-only part of the finishing turn. */
export function finishInstruction(input: { threadId: string; title: string }): string {
  const source = JSON.stringify({ kind: "conversation", id: input.threadId, title: input.title });
  return [
    `Studio: the user archived this conversation (${JSON.stringify(input.title)}, ${input.threadId}). Do this now, in this turn:`,
    `1. Write its summary for someone who wasn't here, in short markdown: "**Decisions**" with one bullet per decision, "**Left open**" with what is still undecided, "**Made**" with the pages, designs, apps or code it produced. Leave out an empty section.`,
    `2. Save it with memory_add: topic ${JSON.stringify(finishTopic(input.title))}, the summary as text, source ${source}.`,
    "3. Call bot_finish_done with the same summary.",
    "Then reply with one short line. Studio archives the conversation and posts the summary to Main.",
  ].join("\n");
}

/** The summary Studio writes when the conversation didn't: its last replies, newest first. */
export function fallbackSummary(replies: readonly string[], latest: string | null): string {
  const items = replies.map((reply) => reply.replace(/::[a-z-]+\{[^}]*\}/g, "").trim()).filter(Boolean).slice(0, 3)
    .map((reply) => `> ${(reply.length > 500 ? `${reply.slice(0, 499)}…` : reply).replace(/\n+/g, "\n> ")}`);
  const body = items.length ? items.join("\n\n") : latest ? `> ${latest}` : "> (no replies)";
  return `**Last replies** (Studio saved these: the conversation ended without writing its summary)\n\n${body}`;
}

/** Main's message: the summary as the conversation's report, with links back. */
export function mainCard(input: { threadId: string; botId: string; title: string; summary: string }): { text: string; note: string } {
  return {
    text: [`Archived “${input.title}” · summary saved`, "", input.summary.trim(), "", `[Open the conversation](/threads/${input.threadId}) · [See in Memory](${memoryPath(input.botId)})`].join("\n"),
    note: `Studio: the user finished the conversation ${JSON.stringify(input.title)} (${input.threadId}); its summary above is saved in your memory. Show it as a card: reply with exactly this line and nothing else:\n::finished{thread="${input.threadId}"}`,
  };
}

export interface FinishedView {
  threadId: string;
  botId: string;
  title: string;
  summary: string;
  startedAt: number;
  finishedAt: number;
  /** Memory records that cite this conversation. */
  records: number;
  memoryHref: string;
  /** Finished and still archived (false once reopened). */
  archived: boolean;
}

export interface FinishMemory {
  add(input: { botId: string; topic: string; text: string; threadId: string; title: string }): void;
  /** Records citing the conversation, since `since` (ms) when given. */
  count(botId: string, threadId: string, since?: number): number;
}

export interface FinishDeps {
  db: Database.Database;
  sdk: Sdk;
  threads: BotThreads;
  /** Every Bot's Main (its chat thread). */
  mainOf(botId: string): string | null;
  isBotThread?(threadId: string): boolean;
  memory: FinishMemory;
  changed(changes: readonly BotChange[]): void;
  log(message: string): void;
  now?(): number;
}

export class BotFinish {
  constructor(private readonly deps: FinishDeps) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  private row(threadId: string): Row | null {
    return (this.deps.db.prepare("SELECT * FROM bot_finishes WHERE thread_id = ?").get(threadId) as Row | undefined) ?? null;
  }

  state(threadId: string): FinishState | null {
    const state = this.row(threadId)?.state;
    return state === "finishing" || state === "finished" || state === "reopened" ? state : null;
  }

  private async titleOf(threadId: string): Promise<string> {
    const rec = this.deps.threads.get(threadId);
    if (rec?.title?.trim()) return rec.title.trim();
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as ThreadFacts | null;
    return thread?.title?.trim() || thread?.titleFallback?.trim() || "Untitled conversation";
  }

  /** A conversation that can be finished, or why not. */
  private finishable(threadId: string) {
    const rec = this.deps.threads.get(threadId);
    if (!rec) throw new Error("That thread isn't a conversation of any Bot.");
    if (rec.kind !== "conversation") throw new Error("A worker can't be finished; its conversation can.");
    if (rec.isMain) throw new Error("Main can't be finished.");
    return rec;
  }

  /** Step 1: the finishing turn, sent into the conversation. */
  async start(threadId: string): Promise<{ state: FinishState }> {
    const rec = this.finishable(threadId);
    if (rec.archivedAt !== null) throw new Error("This conversation is already finished or archived.");
    if (this.state(threadId) === "finishing") return { state: "finishing" };
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as ThreadFacts | null;
    if (BUSY.has(thread?.status ?? "")) throw new Error("It's still working. Finish it when it's done.");
    await this.begin(threadId, rec.botId);
    return { state: "finishing" };
  }

  async archived(threadId: string): Promise<void> {
    if (quietArchives.delete(threadId)) return;
    const rec = this.deps.threads.get(threadId);
    if (!rec || rec.kind !== "conversation" || rec.isMain || this.deps.isBotThread?.(threadId)) return;
    const state = this.state(threadId);
    if (state === "finishing" || state === "finished") return;
    try {
      const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as ThreadFacts | null;
      if (thread?.archivedAt) await this.deps.sdk.threads.unarchive({ threadId });
      await this.begin(threadId, rec.botId);
    } catch (error) {
      this.deps.log(`Finish: the archived conversation ${threadId} couldn't write its summary (${error instanceof Error ? error.message : String(error)}); Studio writes it.`);
      await this.begin(threadId, rec.botId, false);
      await this.fallback(threadId);
    }
  }

  private async begin(threadId: string, botId: string, send = true): Promise<void> {
    const title = await this.titleOf(threadId);
    const now = this.now();
    this.deps.db.prepare(`INSERT INTO bot_finishes (thread_id, bot_id, title, state, requested_at, deadline_at, finished_at, via, bb_archive_pending) VALUES (?, ?, ?, 'finishing', ?, ?, NULL, NULL, 0)
      ON CONFLICT (thread_id) DO UPDATE SET bot_id = excluded.bot_id, title = excluded.title, state = 'finishing', requested_at = excluded.requested_at, deadline_at = excluded.deadline_at, finished_at = NULL, via = NULL, bb_archive_pending = 0`)
      .run(threadId, botId, title, now, now + FINISH_TIMEOUT_MS);
    if (!send) return;
    try {
      await this.deps.sdk.threads.send({
        threadId, mode: "auto",
        input: [
          { type: "text", text: "Archive this conversation.", mentions: [] },
          { type: "text", text: finishInstruction({ threadId, title }), mentions: [], visibility: "agent-only" },
        ],
      } as never);
    } catch (error) {
      this.deps.db.prepare("DELETE FROM bot_finishes WHERE thread_id = ?").run(threadId);
      throw error;
    }
    this.deps.changed([{ botId: botId, kinds: ["conversations"] }]);
  }

  /**
   * Step 2: the summary is in (bot_finish_done, or Studio's fallback). The
   * conversation is archived with it, Main gets the card and its row's line;
   * BB's archive follows when the conversation's turn is over.
   */
  async done(threadId: string, summary: string, via: "bot" | "fallback"): Promise<FinishedView> {
    const rec = this.finishable(threadId);
    const now = this.now();
    let row = this.row(threadId);
    if (!row || row.state !== "finishing") {
      // The Bot finished it when the user asked in the chat: no Finish was pressed.
      const title = await this.titleOf(threadId);
      this.deps.db.prepare(`INSERT INTO bot_finishes (thread_id, bot_id, title, state, requested_at, deadline_at, finished_at, via, bb_archive_pending) VALUES (?, ?, ?, 'finishing', ?, ?, NULL, NULL, 0)
        ON CONFLICT (thread_id) DO UPDATE SET state = 'finishing', title = excluded.title, requested_at = excluded.requested_at, deadline_at = excluded.deadline_at`).run(threadId, rec.botId, title, now, now + FINISH_TIMEOUT_MS);
      row = this.row(threadId)!;
    }
    const text = summary.trim();
    this.deps.db.transaction(() => {
      this.deps.threads.finish(threadId, text);
      this.deps.db.prepare("UPDATE bot_finishes SET state = 'finished', finished_at = ?, via = ?, bb_archive_pending = 1 WHERE thread_id = ?").run(now, via, threadId);
    })();
    const main = this.deps.mainOf(rec.botId);
    if (main) {
      this.deps.threads.setLatest(main, `Archived “${row.title}” · summary saved`);
      const card = mainCard({ threadId, botId: rec.botId, title: row.title, summary: text });
      await this.deps.sdk.threads.send({
        threadId: main, mode: "auto", senderThreadId: threadId,
        input: [{ type: "text", text: card.text, mentions: [] }, { type: "text", text: card.note, mentions: [], visibility: "agent-only" }],
      } as never).catch((error: unknown) => this.deps.log(`Finish: posting to Main failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    await this.archiveIfIdle(threadId);
    this.deps.changed([{ botId: rec.botId, kinds: ["conversations"] }]);
    return this.view(threadId)!;
  }

  /** BB archives the conversation once it isn't in a turn (a tool call is mid-turn). */
  private async archiveIfIdle(threadId: string): Promise<void> {
    const row = this.row(threadId);
    if (!row?.bb_archive_pending || row.state !== "finished") return;
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as ThreadFacts | null;
    if (thread && BUSY.has(thread.status ?? "")) return;
    if (thread && !thread.archivedAt) await this.deps.sdk.threads.archive({ threadId }).catch((error: unknown) => this.deps.log(`Finish: archiving ${threadId} in BB failed: ${error instanceof Error ? error.message : String(error)}`));
    this.deps.db.prepare("UPDATE bot_finishes SET bb_archive_pending = 0 WHERE thread_id = ?").run(threadId);
  }

  /** Step 3: Studio's summary from the last replies; memory too, unless the Bot saved one. */
  async fallback(threadId: string): Promise<FinishedView | null> {
    const row = this.row(threadId);
    if (row?.state !== "finishing") return null;
    const rec = this.deps.threads.get(threadId);
    if (!rec) { this.deps.db.prepare("DELETE FROM bot_finishes WHERE thread_id = ?").run(threadId); return null; }
    const events = await Promise.resolve().then(() => this.deps.sdk.threads.events.list({ threadId, order: "desc", limit: "40", types: ["item/completed"] })).catch(() => []) as { data?: { item?: { type?: string; text?: string } } }[];
    const replies = events.flatMap((event) => event.data?.item?.type === "agentMessage" && event.data.item.text?.trim() ? [event.data.item.text] : []);
    const summary = fallbackSummary(replies, rec.latest?.text ?? null);
    if (!this.deps.memory.count(rec.botId, threadId, row.requested_at)) {
      try { this.deps.memory.add({ botId: rec.botId, topic: finishTopic(row.title), text: summary, threadId, title: row.title }); } catch (error) { this.deps.log(`Finish: saving the summary to memory failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return this.done(threadId, summary, "fallback");
  }

  /** A conversation's turn ended: a finish still waiting gets Studio's summary; a finished one is archived in BB. */
  async ended(threadId: string): Promise<void> {
    const row = this.row(threadId);
    if (!row) return;
    if (row.state === "finishing" && this.now() - row.requested_at >= IDLE_GRACE_MS) await this.fallback(threadId);
    else if (row.state === "finished") await this.archiveIfIdle(threadId);
  }

  /** Every minute: finishes past their deadline, and BB archives still owed. */
  async sweep(): Promise<void> {
    const rows = this.deps.db.prepare("SELECT * FROM bot_finishes WHERE (state = 'finishing' AND deadline_at <= ?) OR (state = 'finished' AND bb_archive_pending = 1)").all(this.now()) as Row[];
    for (const row of rows) {
      try {
        if (row.state === "finishing") await this.fallback(row.thread_id);
        else await this.archiveIfIdle(row.thread_id);
      } catch (error) {
        this.deps.log(`Finish sweep (${row.thread_id}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Reopen: listed again, unarchived in BB; the summary stays. */
  async reopen(threadId: string): Promise<{ ok: boolean }> {
    const rec = this.deps.threads.get(threadId);
    if (!rec || rec.kind !== "conversation") throw new Error("That thread isn't a conversation.");
    this.deps.threads.reopen(threadId);
    this.deps.db.prepare("UPDATE bot_finishes SET state = 'reopened', bb_archive_pending = 0 WHERE thread_id = ?").run(threadId);
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as ThreadFacts | null;
    if (thread?.archivedAt) await this.deps.sdk.threads.unarchive({ threadId }).catch((error: unknown) => this.deps.log(`Reopen: unarchiving ${threadId} in BB failed: ${error instanceof Error ? error.message : String(error)}`));
    this.deps.changed([{ botId: rec.botId, kinds: ["conversations"] }]);
    return { ok: true };
  }

  /** What the Main card and the finished banner show; null for a conversation that wasn't finished. */
  view(threadId: string): FinishedView | null {
    const rec = this.deps.threads.get(threadId);
    const row = this.row(threadId);
    if (!rec?.finishedSummary || !row?.finished_at) return null;
    return {
      threadId, botId: rec.botId, title: row.title, summary: rec.finishedSummary, startedAt: rec.createdAt, finishedAt: row.finished_at,
      records: this.deps.memory.count(rec.botId, threadId), memoryHref: memoryPath(rec.botId), archived: rec.archivedAt !== null,
    };
  }
}

type Bb = Pick<BbPluginApi, "events" | "sdk" | "agents">;

/** The Finish service, its tool, and the events that move it on. */
export function registerBotFinish(bb: Bb, deps: Omit<FinishDeps, "sdk">) {
  const finish = new BotFinish({ ...deps, sdk: bb.sdk });
  const later = (what: string, run: () => Promise<unknown>) => { void run().catch((error: unknown) => deps.log(`Finish (${what}): ${error instanceof Error ? error.message : String(error)}`)); };
  bb.events.on("thread.idle", ({ thread }) => later("idle", () => finish.ended(thread.id)));
  bb.events.on("thread.failed", ({ thread }) => later("failed", () => finish.ended(thread.id)));
  bb.events.on("thread.archived", ({ thread }) => later("archived", () => finish.archived(thread.id)));

  bb.agents.registerTool({
    name: "bot_finish_done",
    description: "Finish this conversation with its summary (the decisions, what was left open, what was made), after you saved it with memory_add. Studio archives the conversation, posts the summary to Main as a card, and keeps it findable in Search and the Library. Use it when Studio asks you to finish, or when the user asks you to finish this conversation. Not in Main or a worker.",
    parameters: z.object({ summary: z.string().trim().min(1).max(6000).describe("The summary in short markdown: **Decisions**, **Left open**, **Made**") }),
    execute: async ({ summary }, ctx) => {
      if (!ctx.threadId) return "This isn't a conversation.";
      const rec = deps.threads.get(ctx.threadId);
      if (!rec || rec.kind !== "conversation") return "Only a conversation can be finished; a worker reports through its result.";
      if (rec.isMain) return "Main can't be finished.";
      const view = await finish.done(ctx.threadId, summary, "bot");
      return `Finished: the conversation is archived, Main has the summary, and ${view.records} memory record${view.records === 1 ? "" : "s"} cite it. Reply with one short line.`;
    },
  });

  const rpc = {
    bot_finish: ({ threadId }: { threadId: string }) => finish.start(threadId),
    bot_reopen: ({ threadId }: { threadId: string }) => finish.reopen(threadId),
    bot_finished: ({ threadId }: { threadId: string }) => ({ finished: finish.view(threadId) }),
  };
  return { finish, rpc, tools: ["bot_finish_done"] as const };
}
