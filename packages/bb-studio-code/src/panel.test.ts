import { describe, expect, it } from "vitest";
import { canEmbedEditor } from "./panel";

describe("where VS Code can show", () => {
  it("embeds only on the computer running BB", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) expect(canEmbedEditor(host)).toBe(true);
    for (const host of ["red4.tailnet.ts.net", "192.168.1.20", "bb.example.com"]) expect(canEmbedEditor(host)).toBe(false);
  });
});

describe("card preview", () => {
  it("shortens folders to their last two parts", async () => {
    const { shortFolder } = await import("./card");
    expect(shortFolder("/tmp/data/worktrees/thr_x-1/orbit")).toBe("thr_x-1/orbit");
    expect(shortFolder("/orbit")).toBe("orbit");
  });
});

describe("BB shortcuts replayed from VS Code", () => {
  it("replays the key as ⌘ on macOS and Ctrl elsewhere, so BB's own listener sees it", async () => {
    const { replayKey } = await import("./panel");
    // Node has Event but not KeyboardEvent; this stand-in carries the same fields.
    (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent ??= class extends Event {
      key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
      constructor(type: string, init: KeyboardEventInit) {
        super(type, init);
        this.key = init.key ?? ""; this.code = init.code ?? ""; this.metaKey = !!init.metaKey; this.ctrlKey = !!init.ctrlKey; this.shiftKey = !!init.shiftKey; this.altKey = !!init.altKey;
      }
    };
    const seen: { key: string; meta: boolean; ctrl: boolean; shift: boolean }[] = [];
    const target = new EventTarget();
    target.addEventListener("keydown", (event) => { const key = event as KeyboardEvent; seen.push({ key: key.key, meta: key.metaKey, ctrl: key.ctrlKey, shift: key.shiftKey }); });
    replayKey({ key: "k", code: "KeyK", mod: true, shift: false, alt: false }, true, target);
    replayKey({ key: "O", code: "KeyO", mod: true, shift: true, alt: false }, false, target);
    expect(seen).toEqual([{ key: "k", meta: true, ctrl: false, shift: false }, { key: "O", meta: false, ctrl: true, shift: true }]);
  });
});

describe("Code's page", () => {
  it("opens a workspace at its link, and the latest one from the root", async () => {
    const { panelRoute } = await import("./panel");
    expect(panelRoute("cws_abc")).toEqual({ kind: "workspace", id: "cws_abc" });
    expect(panelRoute("")).toEqual({ kind: "root" });
    expect(panelRoute("/")).toEqual({ kind: "root" });
    expect(panelRoute("other")).toEqual({ kind: "root" });
  });

  it("picks the workspace last opened, skipping archived, empty and thread worktrees", async () => {
    const Database = (await import("better-sqlite3")).default;
    const { MIGRATIONS, WorkspaceStore } = await import("./server/store");
    const db = new Database(":memory:");
    for (const statement of MIGRATIONS) db.exec(statement);
    const store = new WorkspaceStore(db);
    expect(store.recent()).toBeNull();
    store.create({ title: "Empty", projectId: null, folders: [] });
    expect(store.recent()).toBeNull();
    const thread = store.create({ title: "Thread", projectId: null, folders: ["/t"], threadId: "thr_1" });
    expect(store.recent()?.id).toBe(thread.id);
    const a = store.create({ title: "A", projectId: null, folders: ["/a"] });
    const b = store.create({ title: "B", projectId: null, folders: ["/b"] });
    db.prepare("UPDATE code_workspaces SET updated_at = ? WHERE id = ?").run(1, b.id);
    db.prepare("UPDATE code_workspaces SET updated_at = ? WHERE id = ?").run(2, a.id);
    expect(store.recent()?.id).toBe(a.id);
    store.markOpened(b.id);
    expect(store.recent()?.id).toBe(b.id);
    store.update(b.id, { archived: true });
    expect(store.recent()?.id).toBe(a.id);
  });
});

describe("Code's own page, not Studio's", () => {
  it("takes Code's panel out of Studio's workspace, so its links don't become Studio tabs", async () => {
    const { leaveStudioWorkspace, CODE_ROOT } = await import("./own-page");
    const seen: string[] = [];
    const scope = Object.assign(new EventTarget(), {
      __bbStudioWorkspace_v1: { revision: 3, providers: new Map([[CODE_ROOT, Symbol()], ["/plugins/other/items", Symbol()]]) },
    });
    scope.addEventListener("bb-studio-workspace-change", () => seen.push("changed"));
    expect(leaveStudioWorkspace(scope as unknown as Record<string, unknown>)).toBe(true);
    expect([...scope.__bbStudioWorkspace_v1.providers.keys()]).toEqual(["/plugins/other/items"]);
    expect(scope.__bbStudioWorkspace_v1.revision).toBe(4);
    expect(seen).toEqual(["changed"]);
    expect(leaveStudioWorkspace(scope as unknown as Record<string, unknown>)).toBe(false);
    expect(leaveStudioWorkspace({})).toBe(false);
  });

  it("lists workspaces for the switcher, last opened first, without archived ones", async () => {
    const Database = (await import("better-sqlite3")).default;
    const { MIGRATIONS, WorkspaceStore } = await import("./server/store");
    const db = new Database(":memory:");
    for (const statement of MIGRATIONS) db.exec(statement);
    const store = new WorkspaceStore(db);
    const a = store.create({ title: "A", projectId: null, folders: ["/a"] });
    const b = store.create({ title: "B", projectId: null, folders: [] });
    const c = store.create({ title: "C", projectId: null, folders: ["/c"] });
    db.prepare("UPDATE code_workspaces SET updated_at = ? WHERE id = ?").run(1, a.id);
    db.prepare("UPDATE code_workspaces SET updated_at = ? WHERE id = ?").run(2, b.id);
    db.prepare("UPDATE code_workspaces SET updated_at = ? WHERE id = ?").run(3, c.id);
    store.markOpened(a.id);
    store.update(c.id, { archived: true });
    expect(store.recentList().map((each) => each.title)).toEqual(["A", "B"]);
  });
});
