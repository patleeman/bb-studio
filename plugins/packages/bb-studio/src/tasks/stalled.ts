import { isClosed, type Task } from "./contract";
import { RUNNING, threadsOf, type ThreadFact } from "./links";

export const STALLED_MS = 6 * 3_600_000;

export function stalledTasks(all: readonly Task[], facts: readonly ThreadFact[], now: number): Set<string> {
  if (!facts.length) return new Set();
  const byFact = new Map(facts.map((f) => [f.id, f]));
  const children = new Map<string, Task[]>();
  for (const t of all) if (t.parentId && !isClosed(t)) children.set(t.parentId, [...(children.get(t.parentId) ?? []), t]);
  const threads = (t: Task, seen = new Set<string>()): string[] => {
    if (seen.has(t.id)) return [];
    seen.add(t.id);
    return [...threadsOf(t), ...(children.get(t.id) ?? []).flatMap((c) => threads(c, seen))];
  };
  const quiet = (id: string) => {
    const f = byFact.get(id);
    if (!f || f.archivedAt || f.deletedAt) return true;
    return !RUNNING.has(f.status ?? "") && now - f.updatedAt > STALLED_MS;
  };
  const out = new Set<string>();
  for (const t of all) {
    if (t.state !== "in_progress" || t.stale || t.automation || t.schedule) continue;
    const ids = [...new Set(threads(t))];
    if (ids.length && ids.every(quiet)) out.add(t.id);
  }
  return out;
}
