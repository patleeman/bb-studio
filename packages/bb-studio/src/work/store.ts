import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { changes as changesSchema, createInput, isFinished, SHOW_FINISHED_MS, workCard, type CreateInput, type WorkCard, type WorkChanges } from "./contract";

type Row = { record: string };

const ORDER: Record<WorkCard["state"], number> = { "needs-you": 0, running: 1, waiting: 1, failed: 2, done: 2 };

const back = (before: WorkCard, after: WorkCard) => (isFinished(before) && !isFinished(after)) || (after.state === "needs-you" && before.state !== "needs-you");

export function inFlightOrder(cards: readonly WorkCard[]): WorkCard[] {
  return [...cards].sort((a, b) => ORDER[a.state] - ORDER[b.state] || (isFinished(a) ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : a.createdAt - b.createdAt));
}

export class WorkCardStore {
  constructor(readonly db: Database.Database, readonly changed: () => void = () => {}, readonly now: () => number = Date.now) {}

  get(id: string): WorkCard {
    const row = this.db.prepare("SELECT record FROM work_cards WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error(`Work card ${id} not found`);
    return workCard.parse(JSON.parse(row.record));
  }

  find(id: string): WorkCard | null {
    try { return this.get(id); } catch { return null; }
  }

  create(input: CreateInput & { threadId: string }): WorkCard {
    const x = createInput.parse(input);
    const at = this.now();
    return this.save({
      id: `wc_${randomUUID()}`, threadId: input.threadId, title: x.title, kind: x.kind, state: x.state,
      step: x.step || null, line: x.line || null, needs: x.needs || null, workerThreadId: x.workerThreadId ?? null,
      messageId: null, messageSeq: null, createdAt: at, updatedAt: at, finishedAt: isFinished(x) ? at : null, stale: false, dismissedAt: null,
    });
  }

  update(id: string, input: WorkChanges): WorkCard {
    const x = changesSchema.parse(input);
    const current = this.get(id);
    const empty = (value: string | null | undefined) => (value === undefined ? undefined : value || null);
    const next: WorkCard = {
      ...current,
      ...(x.title !== undefined ? { title: x.title } : {}),
      ...(x.kind !== undefined ? { kind: x.kind } : {}),
      ...(x.state !== undefined ? { state: x.state } : current.stale ? { state: "running" as const } : {}),
      ...(x.step !== undefined ? { step: empty(x.step) ?? null } : {}),
      ...(x.line !== undefined ? { line: empty(x.line) ?? null } : {}),
      ...(x.needs !== undefined ? { needs: empty(x.needs) ?? null } : {}),
      ...(x.workerThreadId !== undefined ? { workerThreadId: x.workerThreadId } : {}),
      updatedAt: this.now(),
      stale: false,
    };
    if (x.state !== undefined && x.state !== "needs-you" && x.needs === undefined) next.needs = null;
    next.finishedAt = isFinished(next) ? (isFinished(current) && !current.stale ? current.finishedAt : this.now()) : null;
    if (back(current, next)) next.dismissedAt = null;
    return this.save(next);
  }

  markStale(id: string): WorkCard {
    const current = this.get(id);
    if (isFinished(current)) return current;
    const at = this.now();
    return this.save({ ...current, state: "done", stale: true, needs: null, finishedAt: at, updatedAt: at });
  }

  revive(id: string): WorkCard {
    const current = this.get(id);
    if (!current.stale) return current;
    return this.save({ ...current, state: "running", stale: false, finishedAt: null, dismissedAt: null, updatedAt: this.now() });
  }

  dismiss(id: string): WorkCard {
    const current = this.get(id);
    if (current.dismissedAt !== null) return current;
    return this.save({ ...current, dismissedAt: this.now() });
  }

  clearFinished(threadId: string): number {
    const finished = this.inFlight(threadId).filter(isFinished);
    if (!finished.length) return 0;
    const at = this.now();
    this.db.transaction(() => { for (const card of finished) this.write({ ...card, dismissedAt: at }); })();
    this.changed();
    return finished.length;
  }

  openWithWorker(): WorkCard[] {
    const rows = this.db.prepare("SELECT record FROM work_cards WHERE finished_at IS NULL").all() as Row[];
    return rows.map((row) => workCard.parse(JSON.parse(row.record))).filter((card) => card.workerThreadId !== null);
  }

  forWorker(workerThreadId: string): WorkCard[] {
    const rows = this.db.prepare("SELECT record FROM work_cards WHERE json_extract(record, '$.workerThreadId') = ?").all(workerThreadId) as Row[];
    return rows.map((row) => workCard.parse(JSON.parse(row.record)));
  }

  anchor(id: string, threadId: string, messageId: string): WorkCard {
    const current = this.get(id);
    if (current.threadId !== threadId || current.messageId) return current;
    return this.save({ ...current, messageId });
  }

  placed(id: string, messageId: string, messageSeq: number): WorkCard {
    const current = this.get(id);
    if (current.messageSeq === messageSeq && current.messageId === messageId) return current;
    return this.save({ ...current, messageId, messageSeq });
  }

  move(id: string, threadId: string): WorkCard {
    const current = this.get(id);
    if (current.threadId === threadId) return current;
    return this.save({ ...current, threadId, messageId: null, messageSeq: null, updatedAt: this.now() });
  }

  inFlight(threadId: string): WorkCard[] {
    const since = this.now() - SHOW_FINISHED_MS;
    const rows = this.db.prepare("SELECT record FROM work_cards WHERE thread_id = ? AND (finished_at IS NULL OR finished_at > ?)").all(threadId, since) as Row[];
    return inFlightOrder(rows.map((row) => workCard.parse(JSON.parse(row.record))).filter((card) => card.dismissedAt === null));
  }

  private write(card: WorkCard): WorkCard {
    const parsed = workCard.parse(card);
    this.db.prepare("INSERT OR REPLACE INTO work_cards (id, thread_id, record, finished_at) VALUES (?, ?, ?, ?)").run(parsed.id, parsed.threadId, JSON.stringify(parsed), parsed.finishedAt);
    return parsed;
  }

  private save(card: WorkCard): WorkCard {
    const parsed = this.write(card);
    this.changed();
    return parsed;
  }
}
