import Database from "better-sqlite3";
import { pageCheckboxes } from "@bb-studio/kit/page-checkbox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardMarkdown, checklistLabel, checklistPrompt, Checklists, checklistTitle, nextChecklistState } from "./checklists";
import { HUMAN_USER_ID } from "./constants";
import { readMarkdown } from "./doc";
import { PagesService } from "./service";
import { MIGRATIONS, PageStore } from "./store";

const services: PagesService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.hub.disposeAll();
});

const board = { id: "brd_1", title: "Launch", projectId: "proj_1", archived: false, template: false,
  columns: [{ id: "todo", label: "To do" }, { id: "in_progress", label: "In progress" }, { id: "done", label: "Done" }] };
const tasks = [
  { id: "tsk_a", title: "Write [notes]", status: "todo", parentId: null, archived: false, handoff: null },
  { id: "tsk_b", title: "Ship it", status: "in_progress", parentId: null, archived: false, handoff: { threadId: "thr_b", state: "working", note: null } },
  { id: "tsk_c", title: "Check links", status: "done", parentId: "tsk_a", archived: false, handoff: null },
  { id: "tsk_d", title: "Old", status: "todo", parentId: null, archived: true, handoff: null },
];

function setup(rpc: (method: string, input: unknown) => unknown) {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  const store = new PageStore(db);
  const calls: [string, unknown][] = [];
  const bb = {
    realtime: { publish: () => {} },
    log: { info: () => {}, warn: () => {} },
    sdk: {
      plugins: { callRpc: vi.fn(async ({ method, input, outputSchema }: { method: string; input: unknown; outputSchema: { parse(value: unknown): unknown } }) => {
        calls.push([method, input]);
        return outputSchema.parse(await rpc(method, input));
      }) },
      system: { config: async () => ({ primaryHostId: "host_1" }) },
      threads: { spawn: vi.fn(async () => ({ id: "thr_new" })) },
    },
  };
  const service = new PagesService(bb as never, store, {} as never);
  services.push(service);
  return { db, store, service, calls, bb, checklists: new Checklists(bb as never, db, service, store) };
}

describe("checklists", () => {
  it("turns a board into checklists grouped by column, subtasks nested, each linking its task", () => {
    const markdown = boardMarkdown(board, tasks);
    expect(markdown).toContain("## To do\n\n- [ ] Write \\[notes\\] [Task](item:studio-tasks:tsk_a)\n  - [x] Check links [Task](item:studio-tasks:tsk_c)");
    expect(markdown).toContain("## In progress\n\n- [ ] Ship it [Task](item:studio-tasks:tsk_b) @[Agent · working](thread:thr_b)");
    expect(markdown).not.toContain("## Done");
    expect(markdown).not.toContain("Old");
  });

  it("follows thread events and reads item titles without links", () => {
    expect(nextChecklistState("starting", "active")).toBe("working");
    expect(nextChecklistState("working", "idle")).toBe("replied");
    expect(nextChecklistState("replied", "idle")).toBeNull();
    expect(nextChecklistState("archived", "unarchived")).toBe("replied");
    expect(nextChecklistState("working", "unarchived")).toBeNull();
    expect(checklistTitle("Ship it [Task](item:studio-tasks:tsk_b) @[Agent · working](thread:thr_b)")).toBe("Ship it");
    const prompt = checklistPrompt({ id: "pg_1", title: "Plan" }, "Ship it", null);
    expect(prompt.text.slice(prompt.mentions[0]!.start, prompt.mentions[0]!.end)).toBe("@Plan");
  });

  it("hands an item to an agent and keeps its thread mention on the thread's state", async () => {
    const { service, checklists, bb } = setup(() => ({}));
    const page = service.createPage({ projectId: "proj_1", parentId: null, title: "Plan", markdown: "- [ ] Ship it\n  - [ ] Nested stays\n", actor: HUMAN_USER_ID });
    const [item] = pageCheckboxes(readMarkdown(service.hub.open(page.id).doc, { ids: true }));
    const { threadId } = await checklists.handOff({ pageId: page.id, blockId: item!.blockId });
    expect(threadId).toBe("thr_new");
    expect(bb.sdk.threads.spawn).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj_1", title: "Ship it" }));
    const read = () => readMarkdown(service.hub.open(page.id).doc);
    expect(read()).toBe(`- [ ] Ship it @[${checklistLabel("starting")}](thread:thr_new)\n  - [ ] Nested stays\n`);
    checklists.signal("thr_new", "active");
    checklists.signal("thr_new", "idle", "Done: shipped.");
    expect(read()).toBe(`- [ ] Ship it @[${checklistLabel("replied")}](thread:thr_new)\n  - [ ] Nested stays\n`);
    expect(checklists.handoffs(page.id)).toMatchObject([{ thread_id: "thr_new", state: "replied", note: "Done: shipped." }]);
  });

  it("migrates each board once, without changing it, and links tasks to their items", async () => {
    const { store, checklists, calls } = setup((method) => {
      if (method === "boards") return { boards: [board, { ...board, id: "brd_t", template: true }] };
      if (method === "board") return { board, tasks };
      return { ok: true };
    });
    expect(await checklists.migrateBoards({ dryRun: true })).toEqual([{ boardId: "brd_1", title: "Launch", pageId: null, tasks: 3, status: "would-create" }]);
    expect(store.list({ includeArchived: true })).toHaveLength(0);

    const [first] = await checklists.migrateBoards();
    expect(first).toMatchObject({ boardId: "brd_1", status: "created", tasks: 3 });
    expect(store.meta(first!.pageId!)).toMatchObject({ title: "Launch", project_id: "proj_1" });
    expect(calls.filter(([method]) => method === "link").map(([, input]) => (input as { id: string }).id).sort()).toEqual(["tsk_a", "tsk_b", "tsk_c"]);
    expect(calls.every(([method]) => ["boards", "board", "link"].includes(method))).toBe(true);
    expect(checklists.handoffs(first!.pageId!)).toMatchObject([{ thread_id: "thr_b", state: "working" }]);

    const [again] = await checklists.migrateBoards();
    expect(again).toMatchObject({ boardId: "brd_1", status: "exists", pageId: first!.pageId });
    expect(store.list({ includeArchived: true })).toHaveLength(1);
  });
});
