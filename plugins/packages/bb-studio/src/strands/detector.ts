// Strand detection for a conversation (phase 1: Main only).
//
// Once a turn finishes, Jev puts it into an open strand, a new one, or none
// (decisions.systemOne.ask, one `choice`); the chat never waits for it. A
// turn that runs long or asks the user something is sorted early, so its
// strand can show running or needs-you; it isn't sorted again at the end.
// New strands start titled with the message's first line; the small model
// (decisions.model.ask) names them in batches, at most every 2 minutes per
// conversation, and folds a new strand into an open one when it is the same
// work. With no Jev, the small model sorts in batches every 5 minutes; with
// neither, a turn goes to the previous turn's strand. At most 300 Jev calls
// per conversation per day, then the previous turn's strand.
//
// The backfill (once per conversation): the newest 300 messages from the
// user, a small-model call proposing up to 12 strands, the conversation's
// open agent tasks as strands, then Jev sorting 32 messages per call.
import { checkName, firstLineTitle } from "./naming";
import {
  BATCH, batchQuestions, MAX_OPEN, namingPrompt, proposePrompt, readAnswer, readNaming, readProposal, readSort, sortPrompt, taskTitle, turnQuestion,
  type Choice, type Message, type OpenStrand,
} from "./sort";
import type { ItemBy, Strand, StrandStore } from "./store";
import { sortable, turnsOf, type EventRow, type Turn } from "./turns";

export const STRANDS_CALLER = "strands";
export const JEV_DAILY_CAP = 300;
export const NAME_EVERY_MS = 2 * 60 * 1000;
export const BATCH_EVERY_MS = 5 * 60 * 1000;
export const SUMMARY_EVERY_MS = 24 * 60 * 60 * 1000;
export const BACKFILL_MESSAGES = 300;
export const NAME_TRIES = 3;
/** A turn running this long is sorted before it finishes. */
export const EARLY_SORT_MS = 30_000;
const EVENT_PAGE = 100;
/** Pages read forward in one go; the rest waits for the next idle. */
const PAGES_PER_READ = 60;
/** Pages read back for the backfill (a busy Main has many tool events per message). */
const BACKFILL_PAGES = 600;
const NAMES_PER_CALL = 8;
const REFRESH_PER_CALL = 4;
/** After Jev says it isn't set up, don't ask again for this long. */
const JEV_DOWN_MS = 10 * 60 * 1000;

type JevResult = { ok: true; answers: Record<string, unknown> } | { ok: false; unavailable: boolean; error: string };
type ModelResult = { ok: true; text: string | null } | { ok: false; unavailable: boolean; error: string };

export interface OpenTask { id: string; title: string; updatedAt: number }

export interface DetectorDeps {
  store: StrandStore;
  events(input: { threadId: string; afterSeq?: number; beforeSeq?: number; order: "asc" | "desc"; limit: number }): Promise<EventRow[]>;
  jev(input: { caller: string; state: unknown; questions: Record<string, unknown> }): Promise<JevResult>;
  model(input: { threadId: string; requestId: string; prompt: string }): Promise<ModelResult>;
  /** Open agent tasks linked to the conversation (not the user's own to-dos, not automation runs). */
  openTasks(threadId: string): OpenTask[];
  changed(threadId: string): void;
  log(message: string): void;
  now?(): number;
  /** Timers, so tests can run them. */
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export interface BackfillReport { messages: number; proposed: number; tasks: number; jevCalls: number; modelCalls: number; sorted: number; unsorted: number }

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

export class StrandDetector {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, unknown>();
  /** Each conversation's turn still going on, once read: its seq and, once sorted early, its strand. */
  private readonly running = new Map<string, { seq: number; strandId: string | null; sorted: boolean }>();
  private jevDownUntil = 0;
  private disposed = false;

  constructor(private readonly deps: DetectorDeps) {}

  private now() { return this.deps.now?.() ?? Date.now(); }
  private get store() { return this.deps.store; }

  dispose(): void {
    this.disposed = true;
    for (const handle of this.timers.values()) this.clear(handle);
    this.timers.clear();
  }

  private timer(key: string, ms: number, run: () => Promise<unknown>): void {
    if (this.disposed || this.timers.has(key)) return;
    const go = () => { this.timers.delete(key); if (!this.disposed) void run().catch((error) => this.deps.log(`Strands: ${message(error)}`)); };
    this.timers.set(key, this.deps.setTimer ? this.deps.setTimer(go, ms) : setTimeout(go, ms));
  }
  private clear(handle: unknown) { if (this.deps.clearTimer) this.deps.clearTimer(handle); else clearTimeout(handle as ReturnType<typeof setTimeout>); }

  /** One job per conversation at a time, in order. */
  private queue<T>(threadId: string, job: () => Promise<T>): Promise<T> {
    const before = this.queues.get(threadId) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(job);
    const tail = next.catch(() => undefined);
    this.queues.set(threadId, tail);
    void tail.then(() => { if (this.queues.get(threadId) === tail) this.queues.delete(threadId); });
    return next;
  }

  /** Waits for a conversation's jobs (tests, the CLI). */
  async settled(threadId: string): Promise<void> { await (this.queues.get(threadId) ?? Promise.resolve()); }

  /** The conversation's running turn's strand, when it was sorted early; null when unsorted or idle. */
  runningStrand(threadId: string): string | null { return this.running.get(threadId)?.strandId ?? null; }
  /** Whether a running turn is known for the conversation (read but not finished). */
  hasRunningTurn(threadId: string): boolean { return this.running.has(threadId); }

  // ---- live sorting ----

  /** A conversation went idle (or failed): sort its finished turns. */
  idle(threadId: string): Promise<number> {
    const key = `early:${threadId}`;
    const handle = this.timers.get(key);
    if (handle !== undefined) { this.clear(handle); this.timers.delete(key); }
    return this.queue(threadId, () => this.sortNew(threadId));
  }

  /** A turn started: if it runs long, sort it before it ends. */
  active(threadId: string): void {
    this.timer(`early:${threadId}`, EARLY_SORT_MS, () => this.early(threadId));
  }

  /** A question or approval is waiting in the conversation: sort the turn that asked now. */
  asked(threadId: string): Promise<void> { return this.early(threadId); }

  private early(threadId: string): Promise<void> {
    return this.queue(threadId, async () => {
      const { turns } = await this.readFrom(threadId);
      const turn = [...turns].reverse().find((each) => !each.done);
      if (!turn) return;
      if (!turn.text.trim()) { this.running.set(threadId, { seq: turn.seq, strandId: null, sorted: false }); return; }
      const item = this.store.item(threadId, turn.kind, turn.seq);
      const strandId = item ? item.strandId : await this.sortTurn(threadId, turn);
      this.running.set(threadId, { seq: turn.seq, strandId, sorted: true });
      this.deps.changed(threadId);
    });
  }

  /** Events after what was read, up to the newest (a bounded number of pages per read). */
  private async readFrom(threadId: string): Promise<{ turns: Turn[]; restFrom: number | null; last: number; more: boolean }> {
    const start = this.store.read(threadId)?.seenSeq ?? 0;
    const rows: EventRow[] = [];
    let after = start;
    let more = false;
    for (let page = 0; ; page++) {
      if (page >= PAGES_PER_READ) { more = true; break; }
      const got = await this.deps.events({ threadId, afterSeq: after, order: "asc", limit: EVENT_PAGE });
      const fresh = got.filter((row) => (row.seq ?? 0) > after);
      rows.push(...fresh);
      const last = fresh.reduce((max, row) => Math.max(max, row.seq ?? 0), after);
      if (got.length < EVENT_PAGE || last === after) break;
      after = last;
    }
    const { turns, restFrom } = turnsOf(rows);
    return { turns, restFrom, last: rows.reduce((max, row) => Math.max(max, row.seq ?? 0), start), more };
  }

  private async sortNew(threadId: string): Promise<number> {
    const read = this.store.read(threadId);
    // Not backfilled yet: the backfill reads this conversation first.
    if (!read || read.backfill === null) return 0;
    const { turns, restFrom, last, more } = await this.readFrom(threadId);
    let sorted = 0;
    for (const turn of turns) {
      if (!turn.done) continue;
      if (this.disposed) return sorted;
      if (!sortable(turn)) continue;
      const existing = this.store.item(threadId, turn.kind, turn.seq);
      const strandId = existing ? existing.strandId : await this.sortTurn(threadId, turn);
      if (!existing) sorted++;
      if (turn.replySeq !== null) this.store.put({ threadId, seq: turn.replySeq, kind: "reply", turnId: turn.turnId, at: turn.at, line: null, strandId, confidence: null, by: "inherit" });
    }
    const open = turns.find((turn) => !turn.done);
    if (open) {
      const known = this.running.get(threadId);
      this.running.set(threadId, known?.seq === open.seq ? known : { seq: open.seq, strandId: null, sorted: false });
    } else this.running.delete(threadId);
    this.store.saveRead(threadId, { seenSeq: restFrom !== null ? Math.max(read.seenSeq, restFrom - 1) : last });
    if (sorted) { this.nameSoon(threadId); this.deps.changed(threadId); }
    if (more) void this.idle(threadId);
    return sorted;
  }

  /** The open strands a prompt shows: the newest 12, with the previous turn's always among them. */
  openStrands(threadId: string, previous: string | null, limit = MAX_OPEN): OpenStrand[] {
    const recent = this.store.recent(threadId, limit);
    if (previous && !recent.some((strand) => strand.id === previous)) {
      const prev = this.store.get(previous);
      if (prev && !prev.mergedInto) recent.splice(limit - 1, recent.length, prev);
    }
    return recent.map((strand) => ({ id: strand.id, title: strand.title, summary: strand.summary, lastLine: this.store.latest(strand.id, threadId)?.line ?? null }));
  }

  /** Sorts one turn, stores its item, and answers its strand. */
  private async sortTurn(threadId: string, turn: Turn): Promise<string | null> {
    const previous = this.store.previous(threadId, turn.seq);
    const put = (strandId: string | null, by: ItemBy, confidence: number | null, unsure = false) => {
      this.store.put({ threadId, seq: turn.seq, kind: turn.kind, turnId: turn.turnId, at: turn.at, line: turn.text, strandId, confidence, by, unsure });
      return strandId;
    };
    if (this.now() < this.jevDownUntil) { this.batchSoon(threadId); return put(previous, "pending", null); }
    if (!this.store.takeJevCall(threadId, dayOf(this.now()), JEV_DAILY_CAP)) return put(previous, "fallback", null);
    const question = turnQuestion({ text: turn.text, reply: turn.reply }, this.openStrands(threadId, previous), previous);
    const result = await this.deps.jev({ caller: STRANDS_CALLER, state: question.state, questions: question.questions }).catch((error): JevResult => ({ ok: false, unavailable: false, error: message(error) }));
    if (!result.ok) {
      if (result.unavailable) this.jevDownUntil = this.now() + JEV_DOWN_MS;
      else this.deps.log(`Strands: Jev failed for ${threadId}: ${result.error}`);
      this.batchSoon(threadId);
      return put(previous, "pending", null);
    }
    const choice = readAnswer(result.answers.strand, question.shown, previous);
    if (!choice) return put(previous, "fallback", null);
    return this.apply(threadId, choice, turn, "jev", put);
  }

  private apply(threadId: string, choice: Choice, turn: Pick<Turn, "seq" | "at" | "text">, by: "jev" | "model", put: (strandId: string | null, by: ItemBy, confidence: number | null, unsure?: boolean) => string | null): string | null {
    if (choice.kind === "none") return put(null, by, choice.confidence);
    if (choice.kind === "strand") return put(choice.strandId, by, choice.confidence, choice.unsure);
    const strand = this.store.create({ threadId, title: firstLineTitle(turn.text), origin: by, seq: turn.seq, at: turn.at });
    this.nameSoon(threadId);
    return put(strand.id, by, choice.confidence);
  }

  // ---- the small model's batches ----

  /** Names new strands within 2 minutes of the last naming. */
  nameSoon(threadId: string): void {
    const last = this.store.read(threadId)?.namedAt ?? 0;
    this.timer(`name:${threadId}`, Math.max(0, last + NAME_EVERY_MS - this.now()), () => this.queue(threadId, () => this.nameNow(threadId)));
  }

  /** Sorts what Jev couldn't within 5 minutes of the last batch. */
  batchSoon(threadId: string): void {
    const last = this.store.read(threadId)?.batchedAt ?? 0;
    this.timer(`batch:${threadId}`, Math.max(0, last + BATCH_EVERY_MS - this.now()), () => this.queue(threadId, () => this.batchNow(threadId)));
  }

  /** One naming call: new strands named or folded into open ones; stale summaries refreshed. */
  async nameNow(threadId: string): Promise<void> {
    const fresh = this.store.unnamed(threadId, NAME_TRIES).slice(0, NAMES_PER_CALL);
    const now = this.now();
    const named = this.store.list(threadId).filter((strand) => strand.named);
    const open = named.filter((strand) => !fresh.some((each) => each.id === strand.id)).slice(0, MAX_OPEN);
    const refresh = named.filter((strand) => strand.lastAt > (strand.summaryAt ?? 0) && now - (strand.summaryAt ?? 0) >= SUMMARY_EVERY_MS).slice(0, REFRESH_PER_CALL);
    if (!fresh.length && !refresh.length) return;
    this.store.saveRead(threadId, { namedAt: now });
    const lines = (strand: Strand, newest: boolean) => (newest ? this.store.newest(strand.id, threadId, 3) : this.store.first(strand.id, threadId, 3)).map((item) => item.line ?? "").filter(Boolean);
    const prompt = namingPrompt({
      fresh: fresh.map((strand, index) => ({ key: `n${index + 1}`, messages: lines(strand, false).length ? lines(strand, false) : [strand.title] })),
      open: open.map((strand, index) => ({ key: `s${index + 1}`, title: strand.title, summary: strand.summary })),
      refresh: refresh.map((strand, index) => ({ key: `r${index + 1}`, title: strand.title, messages: lines(strand, true) })),
    });
    const result = await this.deps.model({ threadId, requestId: `${threadId} name ${now}`, prompt }).catch((error): ModelResult => ({ ok: false, unavailable: false, error: message(error) }));
    if (!result.ok) {
      for (const strand of fresh) this.store.triedName(strand.id);
      if (!result.unavailable) this.deps.log(`Strands: naming failed for ${threadId}: ${result.error}`);
      return;
    }
    const all = this.store.list(threadId);
    const { answers, summaries } = readNaming(result.text, fresh.map((_, index) => `n${index + 1}`), this.store.titles(threadId));
    fresh.forEach((strand, index) => {
      const answer = answers.get(`n${index + 1}`);
      if (!answer) { this.store.triedName(strand.id); return; }
      if (answer.kind === "name") {
        // Names given earlier in this reply count too.
        if (checkName(answer.title, this.store.titles(threadId, strand.id)).length) { this.store.triedName(strand.id); return; }
        this.store.named(strand.id, answer.title, answer.summary);
        return;
      }
      const target = answer.key.startsWith("title:")
        ? all.find((each) => each.id !== strand.id && each.named && each.title.toLowerCase() === answer.key.slice(6).toLowerCase())
        : open[Number(answer.key.slice(1)) - 1];
      if (!target || !this.store.merge(strand.id, target.id)) this.store.triedName(strand.id);
    });
    refresh.forEach((strand, index) => { const summary = summaries.get(`r${index + 1}`); if (summary) this.store.summarized(strand.id, summary); });
    this.deps.changed(threadId);
  }

  /** The small model sorts the turns Jev couldn't; with no model either, they stay in the previous turn's strand. */
  async batchNow(threadId: string): Promise<void> {
    const pending = this.store.pending(threadId, BATCH);
    if (!pending.length) return;
    const now = this.now();
    this.store.saveRead(threadId, { batchedAt: now });
    const previous = this.store.previous(threadId, pending[0]!.seq);
    const open = this.openStrands(threadId, previous);
    const result = await this.deps.model({ threadId, requestId: `${threadId} sort ${now}`, prompt: sortPrompt(pending.map((item) => ({ text: item.line ?? "", reply: "" })), open) })
      .catch((error): ModelResult => ({ ok: false, unavailable: false, error: message(error) }));
    const choices = result.ok ? readSort(result.text, pending.length, open) : [];
    for (const [index, item] of pending.entries()) {
      const put = (strandId: string | null, by: ItemBy, confidence: number | null, unsure = false) => {
        this.store.put({ ...item, strandId, by, confidence, unsure });
        return strandId;
      };
      const choice = choices[index];
      if (choice) this.apply(threadId, choice, { seq: item.seq, at: item.at, text: item.line ?? "" }, "model", put);
      else put(this.store.previous(threadId, item.seq), "fallback", null);
    }
    if (!result.ok && !result.unavailable) this.deps.log(`Strands: batch sort failed for ${threadId}: ${result.error}`);
    if (this.store.pending(threadId, 1).length) this.batchSoon(threadId);
    this.deps.changed(threadId);
  }

  // ---- backfill ----

  /** Whether the conversation still needs its backfill. */
  needsBackfill(threadId: string): boolean { return (this.store.read(threadId)?.backfill ?? null) === null; }

  backfill(threadId: string): Promise<BackfillReport | null> {
    return this.queue(threadId, () => this.backfillNow(threadId));
  }

  private async backfillNow(threadId: string): Promise<BackfillReport | null> {
    if (!this.needsBackfill(threadId)) return null;
    const report: BackfillReport = { messages: 0, proposed: 0, tasks: 0, jevCalls: 0, modelCalls: 0, sorted: 0, unsorted: 0 };
    // The newest 300 messages from the user: read back until there are enough, or the start.
    const rows: EventRow[] = [];
    let before: number | undefined;
    let users = 0;
    for (let page = 0; page < BACKFILL_PAGES && users <= BACKFILL_MESSAGES; page++) {
      const got = await this.deps.events({ threadId, ...(before !== undefined ? { beforeSeq: before } : {}), order: "desc", limit: EVENT_PAGE });
      rows.push(...got);
      users += got.filter((row) => row.type === "client/turn/requested").length;
      const oldest = got.reduce((min, row) => Math.min(min, row.seq ?? min), before ?? Number.MAX_SAFE_INTEGER);
      if (got.length < EVENT_PAGE || oldest === before) break;
      before = oldest;
    }
    rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const { turns, restFrom } = turnsOf(rows);
    const last = rows.reduce((max, row) => Math.max(max, row.seq ?? 0), 0);
    const done = turns.filter((turn) => turn.done && turn.kind === "user").slice(-BACKFILL_MESSAGES);
    report.messages = done.length;

    // 1. Up to 12 strands from the messages' first lines; 2. open tasks as strands.
    const tasks = this.deps.openTasks(threadId).slice(0, 18);
    const taken: string[] = [];
    if (done.length || tasks.length) {
      const keys = tasks.map((_, index) => `t${index + 1}`);
      const result = await this.deps.model({ threadId, requestId: `${threadId} backfill`, prompt: proposePrompt(done.map((turn) => turn.text.split("\n").find((line) => line.trim()) ?? turn.text), tasks.map((task, index) => ({ key: keys[index]!, title: task.title }))) })
        .catch((error): ModelResult => ({ ok: false, unavailable: false, error: message(error) }));
      report.modelCalls++;
      const proposal = result.ok ? readProposal(result.text, keys) : { strands: [], tasks: new Map() };
      tasks.forEach((task, index) => {
        if (this.store.byTask(task.id)) return;
        const named = proposal.tasks.get(keys[index]!);
        const title = named && !taken.some((each) => each.toLowerCase() === named.title.toLowerCase()) ? { title: named.title, named: true } : taskTitle(task.title, taken);
        if (title.named) taken.push(title.title);
        this.store.create({ threadId, title: title.title, summary: named?.summary ?? null, named: title.named, origin: "task", taskId: task.id, seq: null, at: task.updatedAt });
        report.tasks++;
      });
      for (const strand of proposal.strands) {
        if (taken.some((each) => each.toLowerCase() === strand.title.toLowerCase())) continue;
        taken.push(strand.title);
        // No messages yet: its span starts empty and grows with its first message.
        this.store.create({ threadId, title: strand.title, summary: strand.summary, named: true, origin: "backfill", seq: null, at: 0 });
        report.proposed++;
      }
    }

    // 3. Jev sorts the messages, 32 per call (the small model when Jev isn't set up).
    let previous: string | null = null;
    for (let start = 0; start < done.length && !this.disposed; start += BATCH) {
      const batch = done.slice(start, start + BATCH);
      const open = this.openStrands(threadId, previous, 30);
      const messages: Message[] = batch.map((turn) => ({ text: turn.text, reply: turn.reply }));
      const jevUp = this.now() >= this.jevDownUntil && this.store.takeJevCall(threadId, dayOf(this.now()), JEV_DAILY_CAP);
      const asked = jevUp ? batchQuestions(messages, open) : null;
      const result: JevResult | null = asked ? await this.deps.jev({ caller: STRANDS_CALLER, state: asked.state, questions: asked.questions }).catch((error): JevResult => ({ ok: false, unavailable: false, error: message(error) })) : null;
      if (asked && result) report.jevCalls++;
      if (asked && result?.ok) {
        // Each answer reads against the strand of the message before it, as sorted.
        for (const [index, turn] of batch.entries()) {
          const choice = readAnswer(result.answers[`m${index + 1}`], asked.shown, previous);
          previous = this.place(threadId, turn, choice, "jev") ?? previous;
          if (choice) report.sorted++; else report.unsorted++;
        }
        continue;
      }
      if (result && !result.ok && result.unavailable) this.jevDownUntil = this.now() + JEV_DOWN_MS;
      const sorted = await this.deps.model({ threadId, requestId: `${threadId} backfill ${start}`, prompt: sortPrompt(messages, open) }).catch((error): ModelResult => ({ ok: false, unavailable: false, error: message(error) }));
      report.modelCalls++;
      const choices = sorted.ok ? readSort(sorted.text, batch.length, open) : [];
      for (const [index, turn] of batch.entries()) {
        const choice = choices[index];
        if (!choice) { report.unsorted++; continue; }
        previous = this.place(threadId, turn, choice, "model") ?? previous;
        report.sorted++;
      }
    }
    // Proposed strands no message went to aren't kept.
    this.store.db.prepare("DELETE FROM strands WHERE thread_id = ? AND origin = 'backfill' AND last_at = 0 AND NOT EXISTS (SELECT 1 FROM strand_items i WHERE i.thread_id = strands.thread_id AND i.strand_id = strands.id)").run(threadId);
    this.store.saveRead(threadId, { seenSeq: restFrom !== null ? restFrom - 1 : last, backfill: JSON.stringify({ at: this.now(), ...report }) });
    this.nameSoon(threadId);
    this.deps.changed(threadId);
    return report;
  }

  /** A backfilled message's item; answers its strand. */
  private place(threadId: string, turn: Turn, choice: Choice | undefined, by: "jev" | "model"): string | null {
    const put = (strandId: string | null, itemBy: ItemBy, confidence: number | null, unsure = false) => {
      this.store.put({ threadId, seq: turn.seq, kind: turn.kind, turnId: turn.turnId, at: turn.at, line: turn.text, strandId, confidence, by: itemBy, unsure });
      if (turn.replySeq !== null) this.store.put({ threadId, seq: turn.replySeq, kind: "reply", turnId: turn.turnId, at: turn.at, line: null, strandId, confidence: null, by: "inherit" });
      return strandId;
    };
    if (!choice) return null;
    return this.apply(threadId, choice, turn, by, put);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
