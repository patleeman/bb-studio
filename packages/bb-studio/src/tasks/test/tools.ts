// The old task_* agent tools as the task tests drive the task rows' logic.
// Agents no longer have these tools (strand_note replaced them); the tests
// keep calling the same functions by their old names, with the old answers:
// the result as JSON, or "Error: …".
import type Database from "better-sqlite3";
import type { registerTasks } from "../register";
import { guardTasks } from "../store";
import { LoopStore } from "../../loops/store";
import { closedByUser, KEPT_CLOSED } from "../contract";

type Ctx = { threadId?: string | null };
export type TestTool = { name?: string; execute(input: unknown, ctx: unknown): Promise<string> };
type Api = ReturnType<typeof registerTasks>;

/** Adds the old tool names over `api` to `tools`, and returns `api`. */
export function withTaskTools<T extends Api>(tools: Record<string, TestTool>, db: Database.Database, api: T): T {
  const tool = (name: string, run: (input: never, ctx: Ctx) => unknown) => {
    const guarded = guardTasks(db, { execute: (input: never, ctx: Ctx) => run(input, ctx) }, true);
    tools[name] = { name, execute: async (input, ctx) => {
      try { return JSON.stringify(await guarded.execute(input as never, (ctx ?? {}) as never)); } catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}`; }
    } };
  };
  tool("task_create", (x, ctx) => api.create(x, ctx));
  tool("task_update", (x, ctx) => api.update(x, ctx));
  tool("task_get", ({ id }: { id: string }) => api.get(id));
  tool("task_list", (x, ctx) => api.list(x, ctx));
  tool("task_handoff", (x, ctx) => api.handoff(x, ctx));
  tool("task_check", () => api.check());
  return api;
}

type WorkApi = { store: { get(id: string): unknown; tasks: { find(id: string): import("../contract").Task | null } }; create(input: never): { card: { id: string }; directive: string; posted?: string }; update(id: string, changes: never, by: string | null): unknown };

/** The old work_card_* tools as the tests drive work cards' logic (agents no longer have them): the result as JSON, or the old plain answer. */
export function withWorkTools<T extends WorkApi>(tools: Record<string, TestTool>, db: Database.Database, work: T): T {
  const tool = (name: string, run: (input: never, ctx: Ctx) => unknown) => {
    const guarded = guardTasks(db, { execute: (input: never, ctx: Ctx) => run(input, ctx) }, true);
    tools[name] = { name, execute: async (input, ctx) => { const out = await guarded.execute(input as never, (ctx ?? {}) as never); return typeof out === "string" ? out : JSON.stringify(out); } };
  };
  tool("work_card_create", (input: { threadId?: string }, ctx) => {
    const threadId = input.threadId ?? ctx.threadId;
    if (!threadId) return "Pass threadId: the conversation the card goes in.";
    const made = work.create({ ...input, threadId } as never);
    if ("posted" in made && made.posted) return { id: made.card.id, directive: made.directive, note: `This task already has its card in thread ${made.posted}; don't post it again.` };
    return { id: made.card.id, directive: made.directive, post: `Post this line once, on its own line, in thread ${threadId}: ${made.directive}` };
  });
  tool("work_card_update", ({ id, ...rest }: { id: string }, ctx) => {
    const t = work.store.tasks.find(id);
    const kept = !!t && closedByUser(t);
    const card = work.update(id, rest as never, ctx?.threadId ? `thread:${ctx.threadId}` : null) as object;
    return kept ? { ...card, note: KEPT_CLOSED } : card;
  });
  tool("work_card_get", ({ id }: { id: string }) => work.store.get(id));
  return work;
}

/** An old to-do the user typed (the phone's and desktop's add are gone): theirs, surfaced, as loops.add made it. */
export function addTodo(db: Database.Database, text: string) {
  const store = new LoopStore(db);
  const loop = store.add({ title: text, status: "surfaced", owner: "patrick" });
  store.event(loop.id, "added_by_you");
  return loop;
}

/** The old to-do groups, read straight from the store now that loops.list answers empty. */
export const todoGroups = (db: Database.Database) => new LoopStore(db).groups();
