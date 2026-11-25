import Database from "better-sqlite3";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ensureTables } from "../schema-columns";
import { MOBILE_SUPPORT, TAB_KIND_REGISTRY } from "../tab-kinds";
import { workspaceRpcContract } from "./contract";
import type { PanelTab, WorkbenchLike } from "./exec";
import { OFF_SCREEN, registerWorkbenchAgent, WorkbenchRouter, workbenchTools } from "./server";
import type { OpenSpec } from "./shared";
import { WorkspaceStore } from "./store";
import { IMPORT_DONE_KEY, storedPanels } from "./ui/import";
import { localSnapshots, WorkspaceSync, type WorkspaceClient } from "./ui/sync";
import { mobileSupportOf, openSpecOf, refKey, refOfPanelTab, type WorkspaceTabRef } from "./workspace";
import { WORKSPACE_CHANGED_CHANNEL, workspaceChanged, workspaceContract, workspaceState, type WorkspaceChanged } from "./workspace-contract";
import { stateView, WorkspaceService } from "./workspace-server";

const page = (id: string): WorkspaceTabRef => ({ kind: "page", id });

function memoryDb() {
  const db = new Database(":memory:");
  ensureTables(db);
  return db;
}

function service(db = memoryDb()) {
  let clock = 1000;
  let ids = 0;
  const events: WorkspaceChanged[] = [];
  const store = new WorkspaceStore(db, () => ++clock, () => `wt_${++ids}`);
  return { db, store, events, workspace: new WorkspaceService(store, (event) => events.push(event)) };
}

describe("the Workspace store", () => {
  it("opens, focuses, reorders and closes tabs, numbering positions and bumping the version once per change", () => {
    const { store } = service();
    expect(store.get("thr_1")).toEqual({ threadId: "thr_1", tabs: [], activeTabId: null, panelOpen: null, version: 0 });
    expect(store.mutate("thr_1", { op: "open", tab: page("pg_a"), title: "A" }, "user").result).toBe("ok");
    expect(store.mutate("thr_1", { op: "open", tab: page("pg_b"), title: "B", focus: false }, "agent").result).toBe("ok");
    expect(store.mutate("thr_1", { op: "open", tab: page("pg_c"), title: "C", position: 0 }, "agent").result).toBe("ok");
    let state = store.get("thr_1");
    expect(state.tabs.map((tab) => [tab.title, tab.position, tab.openedBy])).toEqual([["C", 0, "agent"], ["A", 1, "user"], ["B", 2, "agent"]]);
    expect(state.activeTabId).toBe("wt_3");
    expect(state.version).toBe(3);
    // Already open: selecting it again is no change; reorder moves it.
    expect(store.mutate("thr_1", { op: "open", tab: page("pg_c"), title: "C" }, "user")).toMatchObject({ result: "unchanged", tabId: "wt_3", created: false });
    expect(store.mutate("thr_1", { op: "reorder", tabId: "wt_3", position: 9 }, "user").result).toBe("ok");
    expect(store.mutate("thr_1", { op: "focus", tabId: "wt_1" }, "user").result).toBe("ok");
    expect(store.mutate("thr_1", { op: "close", tabId: "wt_1" }, "user").result).toBe("ok");
    state = store.get("thr_1");
    expect(state.tabs.map((tab) => tab.title)).toEqual(["B", "C"]);
    expect(state.activeTabId).toBe("wt_2");
    expect(state.version).toBe(6);
    expect(store.mutate("thr_1", { op: "close", tabId: "wt_1" }, "user").result).toBe("notFound");
    expect(store.tabCounts(["thr_1", "thr_none"])).toEqual(new Map([["thr_1", 2]]));
  });

  it("refuses a change made against an older version and changes nothing", () => {
    const { store } = service();
    store.mutate("thr_1", { op: "open", tab: page("pg_a"), title: "A" }, "user", 0);
    const stale = store.mutate("thr_1", { op: "open", tab: page("pg_b"), title: "B" }, "user", 0);
    expect(stale.result).toBe("conflict");
    expect(stale.state.version).toBe(1);
    expect(store.get("thr_1").tabs.map((tab) => tab.title)).toEqual(["A"]);
    expect(store.mutate("thr_1", { op: "open", tab: page("pg_b"), title: "B" }, "user", 1).result).toBe("ok");
  });

  it("keeps what the user closed after the agent opened it across a restart, and the agent reopens it only with force", () => {
    const { db, store } = service();
    store.mutate("thr_1", { op: "open", tab: page("pg_a"), title: "A" }, "agent");
    store.mutate("thr_1", { op: "close", tabId: "wt_1" }, "user");
    const restarted = new WorkspaceStore(db, () => 5000, () => "wt_new");
    expect(restarted.closedByUser("thr_1").map((tab) => tab.title)).toEqual(["A"]);
    expect(restarted.mutate("thr_1", { op: "open", tab: page("pg_a"), title: "A" }, "agent")).toMatchObject({ result: "refused", message: expect.stringMatching(/^Not reopened: the user closed "A"/) });
    // The user may reopen it; it keeps its tab id.
    expect(restarted.mutate("thr_1", { op: "open", tab: page("pg_a"), title: "A" }, "user")).toMatchObject({ result: "ok", tabId: "wt_1", created: true });
    restarted.mutate("thr_1", { op: "close", tabId: "wt_1" }, "user");
    expect(restarted.mutate("thr_1", { op: "open", tab: page("pg_a"), title: "A", force: true }, "agent").result).toBe("ok");
  });

  it("matches a file by path, relative or absolute", () => {
    const { store } = service();
    store.mutate("thr_1", { op: "open", tab: { kind: "file", path: "src/a.ts", environmentId: "env_1" }, title: "a.ts" }, "agent");
    expect(store.mutate("thr_1", { op: "open", tab: { kind: "file", path: "/work/repo/src/a.ts" }, title: "a.ts" }, "user").result).toBe("unchanged");
  });

  it("imports a desktop's tabs only while the server has nothing for the conversation", () => {
    const { store } = service();
    const first = store.importOnce("thr_1", [{ ref: page("pg_a"), title: "A" }, { ref: { kind: "browser", url: "https://example.com" }, title: "Example" }, { ref: page("pg_a"), title: "A again" }], 1, true);
    expect(first.imported).toBe(true);
    expect(first.state).toMatchObject({ version: 1, activeTabId: "wt_2", panelOpen: true });
    expect(first.state.tabs.map((tab) => tab.title)).toEqual(["A", "Example"]);
    expect(store.importOnce("thr_1", [{ ref: page("pg_z"), title: "Z" }], 0, true).imported).toBe(false);
  });
});

describe("change events", () => {
  it("announces each change with its origin and tab count, and nothing for a conflict or no change", async () => {
    const { workspace, events } = service();
    await workspace.mutate("thr_1", { op: "open", tab: page("pg_a"), title: "A" }, "user", { baseVersion: 0, origin: "phone:dev_1" });
    await workspace.mutate("thr_1", { op: "open", tab: page("pg_b"), title: "B" }, "agent");
    await workspace.mutate("thr_1", { op: "open", tab: page("pg_c"), title: "C" }, "user", { baseVersion: 0, origin: "phone:dev_1" });
    await workspace.mutate("thr_1", { op: "focus", tabId: "wt_2" }, "user", { origin: "desktop:w1" });
    expect(events).toEqual([
      { threadId: "thr_1", version: 1, origin: "phone:dev_1", tabCount: 1 },
      { threadId: "thr_1", version: 2, origin: "agent", tabCount: 2 },
    ]);
    for (const event of events) expect(workspaceChanged.parse(event)).toEqual(event);
  });
});

describe("the tools, with no window on screen", () => {
  function tools() {
    const parts = service();
    const published: unknown[] = [];
    const router = new WorkbenchRouter((command) => published.push(command), { claimMs: 30, resultMs: 100 });
    const list = workbenchTools({
      router, workspace: parts.workspace,
      threadTitle: async (id) => (id === "thr_other" ? "Release notes" : null),
      itemTitle: (id) => (id === "pg_plan" ? "Plan" : null),
      botName: () => null, entryTitle: async () => null,
      fileTarget: async (_t, path) => ({ kind: "workspace", environmentId: "env_1", path }),
      workspacePath: async (_t, path) => path,
    });
    const call = (name: string, input: object) => (list.find((tool) => tool.name === name)!.execute as (input: object, ctx: { threadId: string }) => Promise<string>)(input, { threadId: "thr_1" });
    return { ...parts, published, call };
  }

  it("opens, lists, focuses and closes in the Workspace without asking a window", async () => {
    const { call, published, store, events } = tools();
    expect(await call("workbench_open", { type: "page", id: "pg_plan" })).toBe('Opened "Plan" (key "wt_1") and selected it.');
    expect(await call("workbench_open", { type: "conversation", id: "thr_other", focus: false })).toBe('Opened "Release notes" (key "wt_2") behind the selected tab.');
    expect(await call("workbench_open", { type: "page", id: "pg_plan" })).toBe('"Plan" was already open (key "wt_1"); selected it.');
    expect(await call("workbench_list", {})).toBe([
      "2 tabs, panel open.",
      '- key "wt_1": "Plan" (Page, selected, opened by you)',
      '- key "wt_2": "Release notes" (Conversation, opened by you)',
    ].join("\n"));
    expect(await call("workbench_tab", { action: "focus", key: "wt_2" })).toBe('Selected "Release notes".');
    expect(await call("workbench_tab", { action: "close", key: "wt_2" })).toBe('Closed "Release notes".');
    expect(await call("workbench_tab", { action: "close", key: "wt_9" })).toBe('No tab has key "wt_9". Call workbench (op: list) for the current keys.');
    expect(published).toEqual([]);
    expect(store.get("thr_1").tabs.map((tab) => tab.title)).toEqual(["Plan"]);
    expect(events.every((event) => event.origin === "agent")).toBe(true);
  });

  it("doesn't reopen what the user closed after the agent opened it, unless forced, and lists it", async () => {
    const { call, workspace } = tools();
    await call("workbench_open", { type: "page", id: "pg_plan" });
    await workspace.rpcMutate({ threadId: "thr_1", baseVersion: 1, op: "close", tabId: "wt_1", origin: "phone:dev_1" });
    expect(await call("workbench_open", { type: "page", id: "pg_plan" })).toBe('Not reopened: the user closed "Plan" after you opened it. Pass force: true only when the user asks for it.');
    expect(await call("workbench_list", {})).toContain('Closed by the user after you opened them (not reopened without force): "Plan".');
    expect(await call("workbench_open", { type: "page", id: "pg_plan", force: true })).toBe('Opened "Plan" (key "wt_1") and selected it.');
  });

  it("still needs a window for pop_out and arrange, and says so when none shows the conversation", async () => {
    const { call, published } = tools();
    await call("workbench_open", { type: "page", id: "pg_plan" });
    expect(await call("workbench_tab", { action: "pop_out", key: "wt_1" })).toBe(OFF_SCREEN);
    expect(await call("workbench_arrange", { layout: "panel only" })).toBe(OFF_SCREEN);
    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({ op: { type: "popOut", key: "wt_1", item: "page:pg_plan" } });
  });

  it("stores an open into a pane, then notes that no window placed it", async () => {
    const { call, store } = tools();
    expect(await call("workbench_open", { type: "page", id: "pg_plan", pane: "new" })).toBe('Opened "Plan" (key "wt_1") and selected it. This conversation isn\'t on screen in BB, so it wasn\'t placed in pane 2.');
    expect(store.get("thr_1").tabs).toHaveLength(1);
  });
});

describe("the contract", () => {
  const dispose: (() => Promise<void>)[] = [];
  afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

  it("round-trips Get and Mutate through the registered RPCs and publishes workbench-changed", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
    dispose.push(() => harness.lifecycle.dispose());
    const db = bb.storage.database();
    ensureTables(db);
    registerWorkbenchAgent(bb, db, { itemTitle: () => null, botName: () => null, entryTitle: async () => null });
    const call = harness.callRpc as (method: string, input: unknown) => Promise<unknown>;
    const empty = workspaceState.parse(await call("threadWorkbenchGet", { threadId: "thr_1" }));
    expect(empty.version).toBe(0);
    const input = workspaceContract.threadWorkbenchMutate.input.parse({ threadId: "thr_1", baseVersion: 0, op: "open", tab: { kind: "design", id: "dsn_1" }, title: "Phone", origin: "phone:dev_1" });
    const opened = workspaceContract.threadWorkbenchMutate.output.parse(await call("threadWorkbenchMutate", input));
    expect(opened).toMatchObject({ result: "ok", version: 1, tabs: [{ ref: { kind: "design", id: "dsn_1" }, title: "Phone", openedBy: "user", mobileSupport: "native", position: 0 }] });
    const stale = workspaceContract.threadWorkbenchMutate.output.parse(await call("threadWorkbenchMutate", { ...input, tab: { kind: "vscode" }, title: "VS Code" }));
    expect(stale).toMatchObject({ result: "conflict", version: 1 });
    expect(workspaceContract.threadWorkbenchMutate.output.parse(await call("threadWorkbenchMutate", { threadId: "thr_1", baseVersion: 1, op: "close" }))).toMatchObject({ result: "refused", message: "close needs tabId." });
    const signals = harness.realtimeSignals.filter((signal) => signal.channel === WORKSPACE_CHANGED_CHANNEL).map((signal) => signal.payload);
    expect(signals).toEqual([{ threadId: "thr_1", version: 1, origin: "phone:dev_1", tabCount: 1 }]);
    expect(Object.keys(workspaceRpcContract)).toEqual(["threadWorkbenchGet", "threadWorkbenchMutate"]);
  });

  it("gives every tab kind a mobileSupport, and the view carries it", () => {
    for (const entry of TAB_KIND_REGISTRY) expect(["native", "web", "desktopOnly"]).toContain(MOBILE_SUPPORT[entry.id]);
    expect(mobileSupportOf({ kind: "plugin" })).toBe("web");
    const { store } = service();
    store.mutate("thr_1", { op: "open", tab: { kind: "vscode", id: null }, title: "VS Code" }, "user");
    expect(stateView(store.get("thr_1")).tabs[0]!.mobileSupport).toBe("desktopOnly");
  });

  it("turns desktop tabs into refs and back into what the desktop opens", () => {
    const studioTab: PanelTab = { key: "k1", title: "Plan", closable: true, detail: { kind: "plugin", pluginId: "studio", tab: { id: "studio" }, params: { kind: "page", id: "pg_plan" } } };
    expect(refOfPanelTab(studioTab)).toEqual({ kind: "page", id: "pg_plan" });
    expect(refOfPanelTab({ key: "k2", title: "Info", closable: false, detail: { kind: "info" } })).toBeNull();
    expect(refOfPanelTab({ key: "k3", title: "Run", closable: true, detail: { kind: "plugin", pluginId: "other", tab: { id: "x" }, params: { a: 1 } } })).toEqual({ kind: "plugin", pluginId: "other", tabId: "x", params: { a: 1 } });
    expect(openSpecOf({ kind: "page", id: "pg_plan" }, "Plan")).toEqual({ kind: "tab", tab: { id: "studio" }, params: { kind: "page", id: "pg_plan" }, title: "Plan" });
    expect(openSpecOf({ kind: "file", path: "a.ts" }, "a.ts")).toBeNull();
    expect(openSpecOf({ kind: "terminal", terminalId: "term_1" }, "Terminal")).toEqual({ kind: "terminal", terminalId: "term_1" });
  });
});

/** A desktop workbench as BB keeps it, for the sync. */
function fakeDesk() {
  const state = { tabs: [] as PanelTab[], selectedKey: null as string | null, open: true, typing: false, next: 0, refuse: new Set<string>() };
  const detailOf = (spec: OpenSpec): PanelTab["detail"] => spec.kind === "tab" ? { kind: "plugin", pluginId: spec.tab.pluginId ?? "studio", tab: { id: spec.tab.id }, params: spec.params ?? null }
    : spec.kind === "url" ? { kind: "browser", url: spec.url } : spec.kind === "terminal" ? { kind: "terminal", terminalId: spec.terminalId } : spec.kind === "file" ? { kind: "file", path: spec.target.path } : { kind: "diff" };
  const wb: WorkbenchLike = {
    list: () => ({ open: state.open, selectedKey: state.selectedKey, tabs: [...state.tabs] }),
    open: async (spec, { focus }) => {
      if (spec.kind === "url" && state.refuse.has(spec.url)) return null;
      const detail = detailOf(spec);
      const existing = state.tabs.find((tab) => JSON.stringify(tab.detail) === JSON.stringify(detail));
      const key = existing?.key ?? `k${++state.next}`;
      if (!existing) state.tabs.push({ key, title: spec.kind === "tab" ? spec.title ?? "" : spec.kind, closable: true, detail });
      if (focus) state.selectedKey = key;
      return key;
    },
    close: (key) => { const at = state.tabs.findIndex((tab) => tab.key === key); if (at < 0) return false; state.tabs.splice(at, 1); if (state.selectedKey === key) state.selectedKey = state.tabs[at]?.key ?? state.tabs[at - 1]?.key ?? null; return true; },
    focus: (key) => { if (!state.tabs.some((tab) => tab.key === key)) return false; state.selectedKey = key; return true; },
    layout: () => ({ panel: state.open ? "open" : "closed", widthPercent: 40, conversation: "shown" }),
    arrange: () => true,
    isTyping: () => state.typing,
  };
  const userOpens = async (spec: OpenSpec) => wb.open(spec, { focus: true });
  const titles = () => state.tabs.map((tab) => tab.title);
  return { wb, state, userOpens, titles };
}

const pageSpec = (id: string, title: string): OpenSpec => ({ kind: "tab", tab: { id: "studio" }, params: { kind: "page", id }, title });

/** A desktop window synced to a Workspace service through a client that counts its calls. */
function desktop(workspace: WorkspaceService, origin = "desktop:w1", storage = new Map<string, string>(), afterGet: () => Promise<void> = async () => {}) {
  const calls: string[] = [];
  const client: WorkspaceClient = {
    get: async (threadId) => { calls.push("get"); const state = stateView(workspace.get(threadId)); await afterGet(); return state; },
    mutate: async (input) => { calls.push(`${input.op}@${input.baseVersion}`); return workspace.rpcMutate(input); },
    importOnce: async (input) => { calls.push("import"); const result = await workspace.importOnce(input.threadId, input.tabs, input.activeIndex, input.panelOpen, input.origin); return { imported: result.imported, state: stateView(result.state) }; },
  };
  const sync = new WorkspaceSync(origin, client, localSnapshots({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } }));
  return { sync, calls, storage };
}

describe("desktop sync", () => {
  it("brings a window's tabs over on first sight, once, then does nothing while nothing changes", async () => {
    const { workspace, store, events } = service();
    const desk = fakeDesk();
    await desk.userOpens(pageSpec("pg_a", "A"));
    await desk.userOpens({ kind: "url", url: "https://example.com" });
    const { sync, calls } = desktop(workspace);
    expect(await sync.sync("thr_1", desk.wb)).toMatchObject({ imported: true });
    expect(store.get("thr_1").tabs.map((tab) => tab.ref)).toEqual([{ kind: "page", id: "pg_a" }, { kind: "browser", url: "https://example.com" }]);
    expect(store.get("thr_1").activeTabId).toBe(store.get("thr_1").tabs[1]!.tabId);
    expect(events.at(-1)?.origin).toBe("desktop:w1");
    await sync.sync("thr_1", desk.wb);
    await sync.sync("thr_1", desk.wb);
    expect(calls).toEqual(["get", "import"]);
  });

  it("follows the phone and the agent, and skips its own echo", async () => {
    const { workspace, events } = service();
    const desk = fakeDesk();
    const { sync, calls } = desktop(workspace);
    await sync.sync("thr_1", desk.wb);
    // The agent opens a page; the phone opens a design.
    await workspace.mutate("thr_1", { op: "open", tab: page("pg_plan"), title: "Plan" }, "agent");
    expect(sync.changed(events.at(-1)!)).toBe(true);
    expect(await sync.sync("thr_1", desk.wb)).toMatchObject({ applied: ["open page:pg_plan", "focus page:pg_plan"], pushed: [] });
    expect(desk.titles()).toEqual(["Plan"]);
    // The user opens one here: pushed once; its own event is skipped.
    await desk.userOpens(pageSpec("pg_b", "B"));
    expect(await sync.sync("thr_1", desk.wb)).toMatchObject({ pushed: ["open page:pg_b", "focus page:pg_b"] });
    expect(sync.changed(events.at(-1)!)).toBe(false);
    const before = calls.length;
    await sync.sync("thr_1", desk.wb);
    expect(calls.length).toBe(before);
    expect(workspace.get("thr_1").tabs.map((tab) => tab.title)).toEqual(["Plan", "B"]);
  });

  it("merges the phone closing a tab while the desktop opens another in the same second", async () => {
    const { workspace, events } = service();
    const desk = fakeDesk();
    await desk.userOpens(pageSpec("pg_a", "A"));
    await desk.userOpens(pageSpec("pg_b", "B"));
    let race: (() => Promise<unknown>) | null = null;
    const { sync, calls } = desktop(workspace, "desktop:w1", new Map(), async () => { const run = race; race = null; await run?.(); });
    await sync.sync("thr_1", desk.wb);
    const version = workspace.get("thr_1").version;
    const b = workspace.get("thr_1").tabs.find((tab) => tab.title === "B")!.tabId;
    // Same second: the user opens C here, and the phone closes B just after this window read the Workspace.
    await desk.userOpens(pageSpec("pg_c", "C"));
    race = () => workspace.rpcMutate({ threadId: "thr_1", baseVersion: version, op: "close", tabId: b, origin: "phone:dev_1" });
    calls.length = 0;
    // The window's push is made against the version it read: a conflict, nothing overwritten, B still here.
    expect(await sync.sync("thr_1", desk.wb)).toMatchObject({ conflict: true, pushed: [] });
    expect(workspace.get("thr_1").tabs.map((tab) => tab.title)).toEqual(["A"]);
    expect(desk.titles()).toEqual(["A", "B", "C"]);
    expect(sync.isDirty("thr_1")).toBe(true);
    // The phone's event arrives; the next round re-reads and re-diffs: B closes here, C goes up.
    sync.changed(events.at(-1)!);
    expect(await sync.sync("thr_1", desk.wb)).toMatchObject({ conflict: false, applied: ["close page:pg_b"], pushed: ["open page:pg_c", "focus page:pg_c"] });
    expect(calls).toEqual(["get", `open@${version}`, "get", `open@${version + 1}`, `focus@${version + 2}`]);
    expect(desk.titles()).toEqual(["A", "C"]);
    expect(workspace.get("thr_1").tabs.map((tab) => tab.title)).toEqual(["A", "C"]);
    // Settled: its own events are skipped, and another round makes no call.
    expect(events.filter((event) => event.version > version + 1).every((event) => !sync.changed(event))).toBe(true);
    calls.length = 0;
    expect(await sync.sync("thr_1", desk.wb)).toMatchObject({ pushed: [], applied: [] });
    expect(calls).toEqual([]);
  });

  it("closes here what was closed elsewhere, and on the server what was closed here", async () => {
    const { workspace, events } = service();
    const desk = fakeDesk();
    await desk.userOpens(pageSpec("pg_a", "A"));
    await desk.userOpens(pageSpec("pg_b", "B"));
    const { sync } = desktop(workspace);
    await sync.sync("thr_1", desk.wb);
    desk.wb.close(desk.state.tabs[0]!.key);
    expect(await sync.sync("thr_1", desk.wb)).toMatchObject({ pushed: ["close page:pg_a"] });
    const b = workspace.get("thr_1").tabs[0]!;
    await workspace.mutate("thr_1", { op: "close", tabId: b.tabId }, "agent");
    sync.changed(events.at(-1)!);
    expect(await sync.sync("thr_1", desk.wb)).toMatchObject({ applied: ["close page:pg_b"], pushed: [] });
    expect(desk.titles()).toEqual([]);
  });

  it("doesn't close what this window can't show, or the tab the user is typing in", async () => {
    const { workspace, events } = service();
    const desk = fakeDesk();
    desk.state.refuse.add("https://example.com");
    await desk.userOpens(pageSpec("pg_a", "A"));
    const { sync } = desktop(workspace);
    await sync.sync("thr_1", desk.wb);
    await workspace.rpcMutate({ threadId: "thr_1", baseVersion: 1, op: "open", tab: { kind: "browser", url: "https://example.com" }, title: "Example", focus: false, origin: "phone:dev_1" });
    sync.changed(events.at(-1)!);
    await sync.sync("thr_1", desk.wb);
    await sync.sync("thr_1", desk.wb);
    expect(workspace.get("thr_1").tabs.map((tab) => tab.title)).toEqual(["A", "Example"]);
    // The phone closes A while the user types in it here: A stays, and the server gets it back as this window's.
    desk.state.typing = true;
    const a = workspace.get("thr_1").tabs[0]!;
    await workspace.rpcMutate({ threadId: "thr_1", baseVersion: workspace.get("thr_1").version, op: "close", tabId: a.tabId, origin: "phone:dev_1" });
    sync.changed(events.at(-1)!);
    expect(await sync.sync("thr_1", desk.wb)).toMatchObject({ applied: [], pushed: ["open page:pg_a"] });
    expect(desk.titles()).toEqual(["A"]);
  });

  it("keeps the agreed state over a reload, so changes made meanwhile merge instead of piling up", async () => {
    const { workspace, events } = service();
    const desk = fakeDesk();
    await desk.userOpens(pageSpec("pg_a", "A"));
    const storage = new Map<string, string>();
    await desktop(workspace, "desktop:w1", storage).sync.sync("thr_1", desk.wb);
    await workspace.rpcMutate({ threadId: "thr_1", baseVersion: 1, op: "close", tabId: workspace.get("thr_1").tabs[0]!.tabId, origin: "phone:dev_1" });
    // Reloaded window: new id, same storage. It doesn't put A back.
    const again = desktop(workspace, "desktop:w2", storage);
    again.sync.changed(events.at(-1)!);
    expect(await again.sync.sync("thr_1", desk.wb)).toMatchObject({ applied: ["close page:pg_a"], pushed: [] });
    expect(workspace.get("thr_1").tabs).toEqual([]);
  });

  it("joins a conversation the server already has: each side gets what the other has", async () => {
    const { workspace } = service();
    await workspace.mutate("thr_1", { op: "open", tab: page("pg_plan"), title: "Plan" }, "agent");
    const desk = fakeDesk();
    await desk.userOpens(pageSpec("pg_mine", "Mine"));
    const { sync } = desktop(workspace);
    await sync.sync("thr_1", desk.wb);
    expect(desk.titles().sort()).toEqual(["Mine", "Plan"]);
    expect(workspace.get("thr_1").tabs.map((tab) => tab.title).sort()).toEqual(["Mine", "Plan"]);
  });
});

describe("the one-time import of stored side panels", () => {
  it("reads each conversation's stored tabs that the Workspace keeps", () => {
    const entries: Record<string, string> = {
      [`bb.thread.fixedPanelTabsState-${encodeURIComponent("thr_1")}-1`]: JSON.stringify({
        version: 1, lastUsedAt: 1,
        secondary: {
          isOpen: true, activeTabId: "t2",
          tabs: [
            { id: "info", kind: "thread-info" },
            { id: "t1", kind: "plugin-panel", pluginId: "studio", actionId: "studio", paramsJson: JSON.stringify({ kind: "page", id: "pg_a" }), title: "A" },
            { id: "t2", kind: "workspace-file-preview", environmentId: "env_1", path: "src/a.ts", source: { kind: "working-tree" }, statusLabel: null },
            { id: "t3", kind: "browser", url: "https://example.com", title: "Example" },
            { id: "t4", kind: "terminal", terminalId: "term_1" },
            { id: "t5", kind: "new-tab" },
          ],
        },
      }),
      "bb.thread.fixedPanelTabsState-thr_2-1": JSON.stringify({ secondary: { tabs: [{ id: "info", kind: "thread-info" }], activeTabId: null, isOpen: false } }),
      "bb.thread.fixedPanelTabsState-thr_3-1": "{not json",
      [IMPORT_DONE_KEY]: "1",
    };
    const keys = Object.keys(entries);
    const panels = storedPanels({ length: keys.length, key: (index) => keys[index] ?? null, getItem: (key) => entries[key] ?? null });
    expect(panels).toEqual([{
      threadId: "thr_1", activeIndex: 1, panelOpen: true,
      tabs: [
        { ref: { kind: "page", id: "pg_a" }, title: "A" },
        { ref: { kind: "file", path: "src/a.ts", environmentId: "env_1" }, title: "a.ts" },
        { ref: { kind: "browser", url: "https://example.com" }, title: "Example" },
        { ref: { kind: "terminal", terminalId: "term_1" }, title: "Terminal" },
      ],
    }]);
    expect(panels[0]!.tabs.map((tab) => refKey(tab.ref))).toEqual(["page:pg_a", "file:src/a.ts", "url:https://example.com", "terminal:term_1"]);
  });
});
