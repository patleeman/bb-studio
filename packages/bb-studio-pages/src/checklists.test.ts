import Database from "better-sqlite3";
import { pageCheckboxes } from "@bb-studio/kit/page-checkbox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checklistLabel, checklistPrompt, Checklists, checklistTitle, nextChecklistState } from "./checklists";
import { HUMAN_USER_ID } from "./constants";
import { readMarkdown } from "./doc";
import { PagesService } from "./service";
import { MIGRATIONS, PageStore } from "./store";

const services: PagesService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.hub.disposeAll();
});

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
  const service = new PagesService(bb as never, store);
  services.push(service);
  return { db, store, service, calls, bb, checklists: new Checklists(bb as never, db, service, store) };
}

describe("checklists", () => {
  it("follows thread events and reads item titles without links", () => {
    expect(nextChecklistState("starting", "active")).toBe("working");
    expect(nextChecklistState("working", "idle")).toBe("replied");
    expect(nextChecklistState("replied", "idle")).toBeNull();
    expect(nextChecklistState("archived", "unarchived")).toBe("replied");
    expect(nextChecklistState("working", "unarchived")).toBeNull();
    expect(checklistTitle("Ship it @[Agent · working](thread:thr_b)")).toBe("Ship it");
    expect(checklistTitle("↳ Check links")).toBe("Check links");
    expect(checklistTitle("Draft notes @")).toBe("Draft notes");
    const prompt = checklistPrompt({ id: "pg_1", title: "Plan" }, "Ship it", null);
    expect(prompt.text.slice(prompt.mentions[0]!.start, prompt.mentions[0]!.end)).toBe("@Plan");
  });

  it("hands an item to an agent and keeps its thread mention on the thread's state", async () => {
    const { db, service, checklists, bb } = setup(() => ({}));
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
    expect(db.prepare("SELECT * FROM checklist_handoffs WHERE page_id = ?").all(page.id)).toMatchObject([{ thread_id: "thr_new", state: "replied", note: "Done: shipped." }]);
  });
});
