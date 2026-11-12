import type Database from "better-sqlite3";

export const TURN_CONTEXT_MAX = 8_000;

export class ThreadSeeds {
  private hooked = false;

  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  enable(): void {
    this.hooked = true;
  }

  ready(): boolean {
    return this.hooked;
  }

  put(threadId: string, text: string): void {
    this.db.prepare("INSERT OR REPLACE INTO thread_seeds (thread_id, text, created_at) VALUES (?, ?, ?)").run(threadId, text, this.now());
  }

  take(threadId: string): string | null {
    const row = this.db.prepare("DELETE FROM thread_seeds WHERE thread_id = ? RETURNING text").get(threadId) as { text: string } | undefined;
    return row?.text ?? null;
  }

  forget(threadId: string): void {
    this.db.prepare("DELETE FROM thread_seeds WHERE thread_id = ?").run(threadId);
  }
}

export function turnContext(seed: string | null, digest: string | null): string | null {
  const text = [seed, digest].filter((part): part is string => !!part).join("\n\n");
  return text ? text.slice(0, TURN_CONTEXT_MAX) : null;
}
