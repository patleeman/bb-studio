// Short thread titles that keep up with the thread.
//
// BB titles a thread once, from the first ~80 characters of its first
// message, and cuts the result to 48 characters. Studio writes its own title
// when a turn ends instead: from the first request, the latest requests and
// the agent's latest reply, as a 2-5 word name. It titles again as the
// thread grows (after 1, 2, 4, 8… requests, then every 8), and the model
// keeps the current title when it still fits.
//
// A title someone wrote wins. Threads that start with a title (spawned with
// `--title`) are never retitled, and once the title differs from the last
// one Studio wrote, the thread is left alone. `bb studio retitle` turns it
// back on for a thread, including threads from before Studio did this.
// The "Short thread titles" setting turns the automatic part off.
import { errorMessage } from "@bb-studio/kit/format";
import type Database from "better-sqlite3";

export const MAX_TITLE_CHARS = 36;
export const MAX_TITLE_WORDS = 5;
const MAX_STEP = 8;

export type TitleRecord = { threadId: string; title: string | null; prompts: number; locked: boolean };
export type TitleThread = { id: string; title: string | null; hidden: boolean; archived: boolean };
export type TitleContext = { prompts: string[]; promptCount: number; output: string | null };

export type TitlerDeps = {
  thread(threadId: string): Promise<TitleThread | null>;
  /** Requests oldest first: the first one and the latest few, plus how many there are. */
  context(threadId: string): Promise<TitleContext>;
  ask(threadId: string, prompt: string, signal: AbortSignal): Promise<string | null>;
  rename(threadId: string, title: string): Promise<void>;
  log?(message: string): void;
};

export class TitleStore {
  constructor(private readonly db: Database.Database) {}

  get(threadId: string): TitleRecord | null {
    const row = this.db.prepare("SELECT thread_id, title, prompts, locked FROM thread_titles WHERE thread_id = ?").get(threadId) as
      { thread_id: string; title: string | null; prompts: number; locked: number } | undefined;
    return row ? { threadId: row.thread_id, title: row.title, prompts: row.prompts, locked: row.locked === 1 } : null;
  }

  set(record: TitleRecord): void {
    this.db.prepare(
      `INSERT INTO thread_titles (thread_id, title, prompts, locked, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (thread_id) DO UPDATE SET title = excluded.title, prompts = excluded.prompts, locked = excluded.locked, updated_at = excluded.updated_at`,
    ).run(record.threadId, record.title, record.prompts, record.locked ? 1 : 0, Date.now());
  }

  delete(threadId: string): void {
    this.db.prepare("DELETE FROM thread_titles WHERE thread_id = ?").run(threadId);
  }
}

/** The text of each request sent to a thread, from its `client/turn/requested` events. System notices are not requests. */
export function requestTexts(events: readonly unknown[]): string[] {
  return events.flatMap((event) => {
    const row = event as { type?: unknown; data?: { initiator?: unknown; input?: unknown } | null };
    if (row.type !== "client/turn/requested" || row.data?.initiator === "system" || !Array.isArray(row.data?.input)) return [];
    const text = (row.data.input as { type?: unknown; text?: unknown }[])
      .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
      .join("\n")
      .trim();
    return text ? [text] : [];
  });
}

/** Whether a thread with `prompts` requests is due a new title after one written at `titledAt`. */
export function titleDue(titledAt: number, prompts: number): boolean {
  if (prompts < 1) return false;
  if (titledAt < 1) return true;
  return prompts >= Math.min(titledAt * 2, titledAt + MAX_STEP);
}

/** Plain prose for the prompt: no code, links, mentions or control characters. */
export function promptText(value: string, max: number): string {
  const text = value
    .slice(0, 20_000)
    .replace(/```[\s\S]*?(?:```|$)/gu, " [code] ")
    .replace(/<pasted_content[\s\S]*?(?:<\/pasted_content>|$)/gu, " [pasted text] ")
    .replace(/@\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/@[a-z]+:[A-Za-z0-9_:-]+/gu, " ")
    .replace(/https?:\/\/\S+/gu, (url) => url.replace(/^https?:\/\/(?:www\.)?/u, "").split(/[/?#]/u)[0] ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function titlePrompt(context: TitleContext, current: string | null): string {
  const [first = "", ...rest] = context.prompts;
  const latest = rest.slice(-3);
  const lines = [
    "Name this conversation between a user and a coding agent, for a sidebar list the user scans at a glance.",
    "",
    "Rules:",
    `- 2 to ${MAX_TITLE_WORDS} words, at most ${MAX_TITLE_CHARS} characters. Shorter is better.`,
    "- Name the subject first, using the specific nouns the user would look for: the feature, plugin, file, bug or product.",
    "- A noun phrase, not a sentence or instruction. Add one word for the kind of work only when it helps: bug, review, plan, redesign, spike, question.",
    "- Leave out filler: \"Improve\", \"Update\", \"Implement\", \"Help with\", \"Investigate\", \"the\", \"a\", \"and\".",
    "- Sentence case. Keep names as written (BB, Talk, SDK, Codex). No quotes, emoji, ending punctuation or IDs.",
    "- Name what the conversation is about now. If it moved on from the first request, follow it.",
    "",
    "Good: \"Thread title quality\", \"Sidebar drag-and-drop bug\", \"Talk SDK pin\", \"Verizon credit claim\", \"Pages + Talk merge\".",
    "Bad: \"Improve thread title readability and updates\", \"Investigate the GPT dot implementation's\", \"Help\".",
  ];
  if (current) lines.push("", `Current title: ${current}`, "If the current title still fits these rules and the conversation, reply with it unchanged.");
  lines.push("", `First request: ${promptText(first, 1500)}`);
  if (context.promptCount > 1 + latest.length) lines.push(`(${context.promptCount - 1 - latest.length} more requests in between.)`);
  for (const prompt of latest) lines.push(`Later request: ${promptText(prompt, 600)}`);
  if (context.output) lines.push(`Agent's latest reply: ${promptText(context.output, 800)}`);
  lines.push("", "Reply with the title only.");
  return lines.join("\n");
}

/** The model's reply as a title, or null when it is not a usable one. Never cut: a cut title is worse than the old one. */
export function cleanTitle(reply: string | null): string | null {
  if (!reply) return null;
  const line = reply
    .replace(/<think>[\s\S]*?<\/think>/giu, "")
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  if (!line) return null;
  const title = line
    .replace(/^(?:\*\*)?title(?:\*\*)?\s*:\s*/iu, "")
    .replace(/^[#>*_\s-]+|[*_\s]+$/gu, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/gu, "")
    .replace(/[.!?:;,]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!title || title.length > MAX_TITLE_CHARS || title.split(" ").length > MAX_TITLE_WORDS) return null;
  if (/\b(?:thr|proj|env)_[a-z0-9]+\b/iu.test(title)) return null;
  return title;
}

export class ThreadTitler {
  private readonly running = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private readonly again = new Set<string>();

  constructor(private readonly store: TitleStore, private readonly deps: TitlerDeps) {}

  /** A thread that starts with a title was named by someone; leave it. */
  created(thread: TitleThread): void {
    if (thread.hidden || this.store.get(thread.id)) return;
    this.store.set({ threadId: thread.id, title: null, prompts: 0, locked: thread.title !== null });
  }

  deleted(threadId: string): void {
    this.again.delete(threadId);
    this.running.get(threadId)?.controller.abort();
    this.store.delete(threadId);
  }

  /** After a turn: title the thread if it is due. Threads Studio has not seen created are left alone. */
  idle(threadId: string): Promise<void> {
    return this.run(threadId, false);
  }

  /** Title now and keep titling, even if someone renamed it. Returns the new title, or null when it kept the old one. */
  async retitle(threadId: string): Promise<string | null> {
    const thread = await this.deps.thread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found.`);
    await this.stop(threadId);
    this.store.set({ threadId, title: thread.title, prompts: 0, locked: false });
    await this.run(threadId, true);
    const title = this.store.get(threadId)?.title ?? null;
    return title !== thread.title ? title : null;
  }

  dispose(): void {
    this.again.clear();
    for (const { controller } of this.running.values()) controller.abort();
    this.running.clear();
  }

  /** Cancel a run in progress and wait until it has let go of the thread. */
  private async stop(threadId: string): Promise<void> {
    for (let busy = this.running.get(threadId); busy; busy = this.running.get(threadId)) {
      this.again.delete(threadId);
      busy.controller.abort();
      await busy.done;
    }
  }

  private async run(threadId: string, force: boolean): Promise<void> {
    if (this.running.has(threadId)) {
      if (force) await this.stop(threadId);
      else { this.again.add(threadId); return; }
    }
    const controller = new AbortController();
    let failure: unknown;
    const done = this.title(threadId, force, controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      this.deps.log?.(`Studio could not title ${threadId}: ${errorMessage(error)}`);
      failure = error;
    }).finally(() => {
      if (this.running.get(threadId)?.controller === controller) this.running.delete(threadId);
      if (this.again.delete(threadId)) void this.run(threadId, false);
    });
    this.running.set(threadId, { controller, done });
    await done;
    if (force && failure !== undefined) throw failure;
  }

  private async title(threadId: string, force: boolean, signal: AbortSignal): Promise<void> {
    const record = this.store.get(threadId);
    if (!record || record.locked) return;
    const thread = await this.deps.thread(threadId);
    if (!thread || thread.hidden || (thread.archived && !force)) return;
    // Studio wrote one and the thread now has another: someone renamed it.
    if (record.title !== null && thread.title !== record.title) {
      this.store.set({ ...record, locked: true });
      return;
    }
    const context = await this.deps.context(threadId);
    if (!force && !titleDue(record.prompts, context.promptCount)) return;
    if (!context.prompts.length) return;
    const reply = await this.deps.ask(threadId, titlePrompt(context, thread.title), signal);
    signal.throwIfAborted();
    const title = cleanTitle(reply);
    if (!title) this.deps.log?.(`Studio kept the title of ${threadId}: the model replied ${JSON.stringify(reply?.slice(0, 200) ?? null)}.`);
    // Someone may have renamed it while the model was thinking.
    const latest = await this.deps.thread(threadId);
    const now = this.store.get(threadId);
    if (!latest || !now || now.locked || latest.title !== thread.title) return;
    if (title && title !== latest.title) await this.deps.rename(threadId, title);
    this.store.set({ threadId, title: title ?? latest.title, prompts: context.promptCount, locked: false });
  }
}
