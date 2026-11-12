// Workspaces belong to a folder (a worktree, else a project), not a thread;
// agents' edits arrive through BB's file-change event where it exists; the
// editor's own questions go to the thread beside it; and BB's theme reaches
// open editors over the bridge.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerCode } from "./server";
import { MIGRATIONS } from "./server/store";
import { MIGRATIONS as STUDIO_MIGRATIONS } from "../migrations";
import { BB_THEME_VARIABLES, type BbTheme } from "./theme";

const bridge = vi.hoisted(() => ({
  call: null as null | ((id: string, input: unknown) => Promise<unknown>),
  upToDate: true,
  sent: [] as { how: string; id: string; command: { type: string; [key: string]: unknown } }[],
  watched: [] as string[],
}));
vi.mock("./server/runtime", () => ({ CodeServers: class { dispose() {} async sync() {} } }));
vi.mock("./server/watch", () => ({ ThreadWatcher: class {
  watching(id: string) { return bridge.watched.includes(id); }
  watch(id: string) { bridge.watched.push(id); }
  dispose() {}
} }));
vi.mock("./server/bridge", async (original) => ({ ...(await original<typeof import("./server/bridge")>()), Bridges: class {
  constructor(_log: unknown, _connect: unknown, _key: unknown, call: typeof bridge.call) { bridge.call = call; }
  connected() { return true; }
  anyConnected() { return true; }
  upToDate() { return bridge.upToDate; }
  state() { return { focused: true, activeFile: null, openFiles: [], unsavedFiles: [] }; }
  unsaved() { return []; }
  send(id: string, command: never) { bridge.sent.push({ how: "send", id, command }); return true; }
  notify(id: string, command: never) { bridge.sent.push({ how: "notify", id, command }); return true; }
  broadcast(id: string, command: never) { bridge.sent.push({ how: "broadcast", id, command }); return 1; }
  closeAll() {}
} }));

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); bridge.sent = []; bridge.watched = []; bridge.upToDate = true; });

type Thread = { title: string; projectId: string; environmentId?: string | null; status?: string; environment?: { id?: string; path: string | null; hostId: string; name?: string | null; projectId?: string } | null };

/** A BB with threads on worktrees; `fork`: it has the file-change event. */
async function setup(options: { fork?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "code-folder-"));
  const worktree = { id: "env_1", path: dir, hostId: "local", name: "fix-retry", projectId: "proj_1" };
  const threads: Record<string, Thread> = {
    thr_a: { title: "Fix the retry", projectId: "proj_1", environmentId: "env_1", environment: worktree },
    thr_b: { title: "Review the retry", projectId: "proj_1", environmentId: "env_1", environment: worktree },
    thr_plain: { title: "A question", projectId: "proj_1", environment: null },
    thr_plain2: { title: "Another", projectId: "proj_1", environment: null },
  };
  const send = vi.fn(async (_args: unknown) => undefined);
  const spawn = vi.fn(async (_args: unknown) => ({ id: "thr_new" }));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: { get: async ({ threadId }: { threadId: string }) => { const thread = threads[threadId]; if (!thread) throw new Error("Thread not found."); return { id: threadId, status: "idle", ...thread }; }, send, spawn },
    environments: { get: async ({ environmentId }: { environmentId: string }) => { if (environmentId !== "env_1") throw new Error("Environment not found."); return worktree; } },
    projects: { get: async () => ({ name: "Studio", sources: [{ hostId: "elsewhere", path: "/remote", isDefault: true }, { hostId: "local", path: dir, isDefault: false }] }) },
    system: { config: async () => ({ primaryHostId: "local" }) },
  } as never });
  cleanup.push(async () => { await harness.lifecycle.dispose(); await rm(dir, { recursive: true, force: true }); });
  // A stock BB refuses an event name it doesn't know; the fork has the file-change event.
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  const events = { on: (name: string, handler: (payload: unknown) => void) => {
    if (name.startsWith("experimental_") && !options.fork) throw new Error(`Unknown event: ${name}`);
    handlers.set(name, [...(handlers.get(name) ?? []), handler]);
  } };
  const host = new Proxy(bb, { get: (target, key) => (key === "events" ? events : Reflect.get(target, key)) });
  const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
  const { store } = registerCode(host, db);
  const emit = (name: string, payload: unknown) => { for (const handler of handlers.get(name) ?? []) handler(payload); };
  const rpc = harness.behavior.callRpc as (method: string, input: unknown) => Promise<{ workspace: { id: string; folderKey: string | null; title: string; threadId: string | null; folders: string[] } }>;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  return { dir, store, rpc, emit, handlers, harness, send, spawn, settle, tool: (name: string, input: unknown, threadId: string) => harness.behavior.callAgentTool(name, input, { threadId }) };
}

describe("one workspace per folder", () => {
  it("gives two threads on one worktree the same workspace, named for the worktree", async () => {
    const x = await setup();
    const a = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    const b = (await x.rpc("code.forThread", { threadId: "thr_b" })).workspace;
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ folderKey: "env:env_1", title: "fix-retry", threadId: null, folders: [x.dir] });
    expect(x.store.list()).toHaveLength(1);
    // The worktree's own tab opens that same workspace.
    expect((await x.rpc("code.forFolder", { environmentId: "env_1" })).workspace.id).toBe(a.id);
  });

  it("names the workspace opened last as the recent one, and none before any exists", async () => {
    const x = await setup();
    expect((await x.rpc("code.recent", null)).workspace).toBeNull();
    const a = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    const plain = (await x.rpc("code.forThread", { threadId: "thr_plain" })).workspace;
    x.store.markOpened(a.id);
    expect((await x.rpc("code.recent", null)).workspace?.id).toBe(a.id);
    expect(plain.id).not.toBe(a.id);
  });

  it("passes over a last workspace whose folder is gone, lists it as missing, and refuses to start it", async () => {
    const x = await setup();
    const a = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    const gone = x.store.create({ title: "Deleted worktree", projectId: null, folders: [join(x.dir, "no-such-folder")], folderKey: "env:env_gone" });
    const empty = x.store.create({ title: "No folder", projectId: null, folders: [] });
    x.store.markOpened(a.id);
    await x.settle();
    x.store.markOpened(gone.id);
    // The VS Code panel opens the recent one with no thread to check it: it must be one VS Code can start.
    expect((await x.rpc("code.recent", null)).workspace?.id).toBe(a.id);
    const listed = (await x.rpc("code.list", null) as unknown as { workspaces: { id: string; missing: boolean }[] }).workspaces;
    expect(listed.map(({ id, missing }) => ({ id, missing }))).toEqual(expect.arrayContaining([{ id: a.id, missing: false }, { id: gone.id, missing: true }, { id: empty.id, missing: true }]));
    expect(listed[0]!.id).toBe(gone.id);
    await expect(x.rpc("code.open", { id: gone.id })).rejects.toThrow(/folder is gone/);
    await expect(x.rpc("code.open", { id: empty.id })).rejects.toThrow(/no folder to open/);
  });

  it("has no recent workspace when every folder is gone, so the picker shows", async () => {
    const x = await setup();
    x.store.create({ title: "Deleted worktree", projectId: null, folders: [join(x.dir, "no-such-folder")] });
    expect((await x.rpc("code.recent", null)).workspace).toBeNull();
  });

  it("uses the project's folder on this machine for a thread with no worktree", async () => {
    const x = await setup();
    const first = (await x.rpc("code.forThread", { threadId: "thr_plain" })).workspace;
    expect(first).toMatchObject({ folderKey: "project:proj_1", title: "Studio", folders: [x.dir] });
    expect((await x.rpc("code.forThread", { threadId: "thr_plain2" })).workspace.id).toBe(first.id);
    expect((await x.rpc("code.forFolder", { projectId: "proj_1" })).workspace.id).toBe(first.id);
    // A worktree and its project are different folders to BB, so different editors.
    expect((await x.rpc("code.forThread", { threadId: "thr_a" })).workspace.id).not.toBe(first.id);
  });

  it("turns a thread's older workspace into its worktree's, so the next thread shares it", async () => {
    const x = await setup();
    const old = x.store.create({ title: "Fix the retry", projectId: "proj_1", folders: [x.dir], threadId: "thr_a" });
    expect(old.folderKey).toBeNull();
    const a = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    expect(a).toMatchObject({ id: old.id, folderKey: "env:env_1", title: "fix-retry", threadId: "thr_a" });
    expect((await x.rpc("code.forThread", { threadId: "thr_b" })).workspace.id).toBe(old.id);
    expect(x.store.list()).toHaveLength(1);
  });

  it("keeps the agent's tools on the shared workspace, whichever thread calls", async () => {
    const x = await setup();
    expect(await x.tool("code_workspace_open", {}, "thr_a")).toContain(x.dir);
    expect(await x.tool("code_workspace_open", {}, "thr_b")).toContain(x.dir);
    expect(x.store.list()).toHaveLength(1);
    // The first thread to use it is where its review goes, until a tab shows it beside another.
    expect(x.store.reviewThread(x.store.list()[0]!.id)).toBe("thr_a");
  });

  it("ships the folder column in both migration lists, at the end", () => {
    expect(MIGRATIONS.at(-1)).toContain("ADD COLUMN folder_key");
    // Studio's list is append-only and has grown since (the Explorer's tables): the statement is in it, once.
    expect(STUDIO_MIGRATIONS.filter((sql) => sql.includes("ADD COLUMN folder_key"))).toHaveLength(1);
  });
});

describe("agents' edits from BB's file-change event", () => {
  const changed = (x: Awaited<ReturnType<typeof setup>>, changes: unknown[]) => x.emit("experimental_thread.fileChanged", { thread: { id: "thr_a" }, changes });

  it("tells every editor holding the file to reload it, then follows the edit, with no watcher", async () => {
    const x = await setup({ fork: true });
    const { id } = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    changed(x, [
      { itemId: "i1", path: join(x.dir, "a.ts"), kind: "update" },
      { itemId: "i1", path: "src/b.ts", kind: "add" },
      { itemId: "i2", path: join(x.dir, "gone.ts"), kind: "delete" },
      { itemId: "i3", path: "/elsewhere/c.ts", kind: "update" },
    ]);
    await x.settle();
    expect(bridge.sent.filter((each) => each.command.type === "refresh")).toEqual([
      { how: "broadcast", id, command: { type: "refresh", path: join(x.dir, "a.ts") } },
      { how: "broadcast", id, command: { type: "refresh", path: join(x.dir, "src/b.ts") } },
    ]);
    const edits = bridge.sent.filter((each) => each.command.type === "activity");
    expect(edits.map((each) => each.command.activity)).toEqual([
      { kind: "edit", path: join(x.dir, "a.ts"), added: [] },
      { kind: "edit", path: join(x.dir, "src/b.ts"), added: [] },
    ]);
    expect(edits[0]).toMatchObject({ how: "notify", id, command: { by: "Fix the retry", threadId: "thr_a" } });
    // The reload goes out before the edit is followed.
    expect(bridge.sent.findIndex((each) => each.command.type === "refresh")).toBeLessThan(bridge.sent.findIndex((each) => each.command.type === "activity"));
    // Turns start and end from BB's events too: nothing reads the thread on a timer.
    x.emit("thread.active", { thread: { id: "thr_a" } });
    x.emit("thread.idle", { thread: { id: "thr_a" } });
    await x.settle();
    expect(bridge.sent.filter((each) => each.command.type === "activity").slice(2).map((each) => each.command.activity)).toEqual([{ kind: "turn", state: "working" }, { kind: "turn", state: "done" }]);
    expect(bridge.watched).toEqual([]);
  });

  it("falls back to reading the thread's events where BB refuses the event", async () => {
    const x = await setup();
    expect(x.handlers.has("experimental_thread.fileChanged")).toBe(false);
    await x.rpc("code.forThread", { threadId: "thr_a" });
    x.emit("thread.active", { thread: { id: "thr_a" } });
    await x.settle();
    expect(bridge.watched).toEqual(["thr_a"]);
    expect(bridge.sent.filter((each) => each.command.type === "activity")).toEqual([]);
  });
});

describe("asking BB from the editor", () => {
  const pointed = { path: "", startLine: 12, endLine: 14, text: "if (attempt > MAX) throw error;", language: "typescript", question: "Why throw here?" };

  it("sends the question and the code to the thread beside the editor", async () => {
    const x = await setup();
    const { id } = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    await x.rpc("code.viewedFrom", { id, threadId: "thr_b" });
    const answer = await bridge.call!(id, { method: "ask", ...pointed, path: join(x.dir, "src/retry.ts") });
    expect(answer).toEqual({ sentTo: "Review the retry" });
    expect(x.send).toHaveBeenCalledWith({ threadId: "thr_b", mode: "auto", input: [{ type: "text", mentions: [], text: "Why throw here?\n\nsrc/retry.ts:12–14\n```typescript\nif (attempt > MAX) throw error;\n```" }] });
  });

  it("refuses a file outside the workspace, and a question with no thread to go to", async () => {
    const x = await setup();
    const { id } = (await x.rpc("code.forFolder", { environmentId: "env_1" })).workspace;
    await expect(bridge.call!(id, { method: "ask", ...pointed, path: "/etc/hosts" })).rejects.toThrow("isn't in this workspace");
    await expect(bridge.call!(id, { method: "ask", ...pointed, path: join(x.dir, "a.ts") })).rejects.toThrow("beside a chat first");
    expect(x.send).not.toHaveBeenCalled();
  });

  it("starts a new thread on the same worktree, seeded with the code, and opens it in BB", async () => {
    const x = await setup();
    const { id } = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    expect(await bridge.call!(id, { method: "newThread", ...pointed, path: join(x.dir, "a.ts"), startLine: 3, endLine: 3, question: "Refactor this" })).toEqual({ threadId: "thr_new" });
    expect(x.spawn).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "proj_1",
      environment: { type: "reuse", environmentId: "env_1" },
      input: [{ type: "text", mentions: [], text: "Refactor this\n\na.ts:3\n```typescript\nif (attempt > MAX) throw error;\n```" }],
    }));
    expect(x.harness.inspection.realtimeSignals).toContainEqual({ channel: "studio-code-changed", payload: { type: "open", id, open: { kind: "thread", threadId: "thr_new" } } });
  });

  it("starts it in the project when the editor is a project's folder", async () => {
    const x = await setup();
    const { id } = (await x.rpc("code.forThread", { threadId: "thr_plain" })).workspace;
    await bridge.call!(id, { method: "newThread", ...pointed, path: join(x.dir, "a.ts") });
    expect(x.spawn).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj_1", environment: { type: "project-default" } }));
  });

  it("asks BB's page to show the file in BB's own preview, at the line", async () => {
    const x = await setup();
    const { id } = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    expect(await bridge.call!(id, { method: "showInBb", path: join(x.dir, "src/retry.ts"), line: 40 })).toEqual({ ok: true });
    expect(x.harness.inspection.realtimeSignals).toContainEqual({ channel: "studio-code-changed", payload: { type: "open", id, open: { kind: "file", line: 40, target: { kind: "workspace", environmentId: "env_1", path: "src/retry.ts" } } } });
  });
});

describe("one way to show a file in VS Code", () => {
  it("sends a link's reveal and the agent's code_show as the same command", async () => {
    const x = await setup();
    const { id } = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(x.dir, "a.ts"), "one\ntwo\nthree\n");
    await x.rpc("code.reveal", { id, path: "a.ts", startLine: 2 });
    await x.tool("code_show", { path: "a.ts", startLine: 2 }, "thr_b");
    const shows = bridge.sent.filter((each) => each.command.type === "show");
    expect(shows).toHaveLength(2);
    expect(shows[0]).toEqual({ how: "send", id, command: { type: "show", path: join(x.dir, "a.ts"), startLine: 2, endLine: 2 } });
    expect(shows[1]).toEqual(shows[0]);
  });
});

describe("BB's theme in open editors", () => {
  const theme: BbTheme = { mode: "dark", colors: Object.fromEntries(BB_THEME_VARIABLES.map((name) => [name, "#123456"])) as BbTheme["colors"] };
  const sync = (x: Awaited<ReturnType<typeof setup>>, next: BbTheme) => (x.harness.behavior.callRpc as (method: string, input: unknown) => Promise<unknown>)("code.syncTheme", next);

  it("sends the colors over the bridge, so an open editor restyles without a reload", async () => {
    const x = await setup();
    const { id } = (await x.rpc("code.forThread", { threadId: "thr_a" })).workspace;
    expect(await sync(x, theme)).toEqual({ changed: true, reload: false });
    const sent = bridge.sent.filter((each) => each.command.type === "theme");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ how: "broadcast", id, command: { type: "theme", base: "Dark Modern" } });
    expect((sent[0]!.command.colors as Record<string, string>)["editor.background"]).toBe("#123456");
    // The same theme again changes nothing and sends nothing.
    expect(await sync(x, theme)).toEqual({ changed: false, reload: false });
    expect(bridge.sent.filter((each) => each.command.type === "theme")).toHaveLength(1);
    await sync(x, { ...theme, mode: "light" });
    expect(bridge.sent.filter((each) => each.command.type === "theme")[1]).toMatchObject({ command: { base: "Light Modern" } });
  });

  it("asks for a reload only where an open editor is too old to restyle itself", async () => {
    const x = await setup();
    await x.rpc("code.forThread", { threadId: "thr_a" });
    bridge.upToDate = false;
    expect(await sync(x, theme)).toEqual({ changed: true, reload: true });
  });
});
