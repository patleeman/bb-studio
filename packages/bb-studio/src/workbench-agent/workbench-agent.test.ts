import { describe, expect, it } from "vitest";
import { TAB_KIND_REGISTRY } from "../tab-kinds";
import { adaptWorkbench, clearSeenMark, PANE_LIMITS, type HostWorkbenchLike, type PanelTab, type WorkbenchLike } from "./exec";
import { fileTargetIn, NO_ANSWER, OFF_SCREEN, openOp, STACKED, WorkbenchRecords, WorkbenchRouter, workbenchTools, type WorkbenchToolDeps } from "./server";
import { adaptLayout, NEW_MARK, type OpenSpec, type WorkbenchLayout } from "./shared";
import { handleCommand } from "./ui/bridge";

/** A conversation's workbench as BB keeps it: tabs, the selected one, the layout, and whether the user is typing. */
function fakeWorkbench() {
  const state = { selectedKey: null as string | null, tabs: [] as PanelTab[], layout: { panel: "open", widthPercent: 40, conversation: "shown" } as WorkbenchLayout, typing: false, next: 0, opened: [] as { spec: OpenSpec; focus: boolean }[] };
  const detailOf = (spec: OpenSpec): PanelTab["detail"] => spec.kind === "tab" ? { kind: "plugin", pluginId: spec.tab.pluginId ?? "studio", tab: { id: spec.tab.id }, params: spec.params ?? null }
    : spec.kind === "file" ? { kind: "file", path: spec.target.path } : spec.kind === "url" ? { kind: "browser", url: spec.url } : { kind: "plugin", pluginId: "bb--git", tab: { id: "git-diff" }, params: null };
  const wb: WorkbenchLike = {
    list: () => ({ open: state.layout.panel === "open", selectedKey: state.selectedKey, tabs: [...state.tabs] }),
    open: async (spec, { focus }) => {
      state.opened.push({ spec, focus });
      if (spec.kind === "url") return null;
      const detail = detailOf(spec);
      const existing = state.tabs.find((tab) => JSON.stringify(tab.detail) === JSON.stringify(detail));
      const key = existing?.key ?? `k${++state.next}`;
      if (!existing) state.tabs.push({ key, title: spec.kind === "tab" ? spec.title ?? "" : spec.kind, closable: true, detail });
      if (focus) { state.selectedKey = key; state.layout.panel = "open"; }
      return key;
    },
    close: (key) => {
      const at = state.tabs.findIndex((tab) => tab.key === key);
      if (at < 0) return false;
      state.tabs.splice(at, 1);
      if (state.selectedKey === key) state.selectedKey = state.tabs[0]?.key ?? null;
      return true;
    },
    focus: (key) => {
      if (!state.tabs.some((tab) => tab.key === key)) return false;
      state.selectedKey = key;
      state.layout.panel = "open";
      return true;
    },
    layout: () => ({ ...state.layout }),
    arrange: (layout) => { Object.assign(state.layout, layout); return true; },
    isTyping: () => state.typing,
  };
  return { wb, state };
}

/** The tools wired to a router whose window shows `onScreen` conversations' workbenches. */
function harness(onScreen: Record<string, WorkbenchLike> = {}) {
  const published: string[] = [];
  let router: WorkbenchRouter;
  router = new WorkbenchRouter((command) => {
    published.push(command.threadId);
    void handleCommand(command, {
      workbench: (threadId) => onScreen[threadId] ?? null,
      claim: async (requestId) => router.claim(requestId),
      reply: async (requestId, message, record) => router.reply(requestId, message, record),
    });
  }, { claimMs: 40, resultMs: 1000 });
  const records = new WorkbenchRecords();
  const deps: WorkbenchToolDeps = {
    router, records,
    threadTitle: async (id) => (id === "thr_other" ? "Release notes" : null),
    itemTitle: (id) => (id === "pg_plan" ? "Plan" : null),
    botName: (id) => (id === "bot_main" ? "Chief of Staff" : null),
    entryTitle: async () => null,
    fileTarget: async (_threadId, path) => ({ kind: "workspace", environmentId: "env_1", path }),
    workspacePath: async (_threadId, path) => path,
  };
  const tools = workbenchTools(deps);
  const call = (name: string, input: object, threadId = "thr_1") => (tools.find((tool) => tool.name === name)!.execute as (input: object, ctx: { threadId: string }) => Promise<string>)(input, { threadId });
  return { call, published, records, tools };
}

describe("routing a call to the window showing the conversation", () => {
  it("runs the call in the window that shows the conversation and returns its answer", async () => {
    const { wb, state } = fakeWorkbench();
    const { call } = harness({ thr_1: wb });
    const text = await call("workbench_open", { type: "page", id: "pg_plan" });
    expect(text).toBe('Opened "Plan" (key "k1") and selected it.');
    expect(state.opened[0]).toEqual({ spec: { kind: "tab", tab: { id: "studio" }, params: { kind: "page", id: "pg_plan" }, title: "Plan" }, focus: true });
  });

  it("says the conversation isn't on screen when no window claims the call", async () => {
    const { wb, state } = fakeWorkbench();
    const { call, published } = harness({ thr_elsewhere: wb });
    expect(await call("workbench_open", { type: "page", id: "pg_plan" })).toBe(OFF_SCREEN);
    expect(published).toEqual(["thr_1"]);
    expect(state.opened).toEqual([]);
  });

  it("lets only the first window run a call, and reports a window that never answers", async () => {
    const outcomes: unknown[] = [];
    const router = new WorkbenchRouter(() => {}, { claimMs: 1000, resultMs: 30 }, () => "req_1");
    const pending = router.call("thr_1", { type: "list" }, { opened: [], dismissed: [], layoutSet: {}, userLayout: [] }).then((outcome) => outcomes.push(outcome));
    expect(router.claim("req_1")).toBe(true);
    expect(router.claim("req_1")).toBe(false);
    await pending;
    expect(outcomes).toEqual([{ status: "timeout" }]);
    expect(router.reply("req_1", "late", { opened: [], dismissed: [], layoutSet: {}, userLayout: [] })).toBe(false);
  });

  it("answers the agent's own mistakes before reaching the window", async () => {
    const { call, published } = harness({});
    expect(await call("workbench_open", { type: "page", id: "pg_missing" })).toBe("No page has id pg_missing.");
    expect(await call("workbench_open", { type: "conversation", id: "thr_1" })).toBe("That's this conversation; it can't open beside itself.");
    expect(published).toEqual([]);
  });
});

describe("the user's focus and choices", () => {
  it("opens behind the selected tab, marked new, while the user types in the panel", async () => {
    const { wb, state } = fakeWorkbench();
    await wb.open({ kind: "file", target: { kind: "workspace", environmentId: "env_1", path: "notes.md" } }, { focus: true });
    state.typing = true;
    const { call } = harness({ thr_1: wb });
    const text = await call("workbench_open", { type: "conversation", id: "thr_other" });
    expect(text).toBe('Opened "Release notes" (key "k2") behind the selected tab, marked new: the user is typing in the panel.');
    expect(state.opened[1]).toMatchObject({ focus: false, spec: { title: `${NEW_MARK}Release notes` } });
    expect(state.selectedKey).toBe("k1");
    expect(await call("workbench_focus", { key: "k2" })).toMatch(/^Not switched: the user is typing/);
    expect(state.selectedKey).toBe("k1");
  });

  it("takes the new mark off a Studio tab once the user selects it", () => {
    const { wb, state } = fakeWorkbench();
    const marked: PanelTab = { key: "k2", title: `${NEW_MARK}Release notes`, closable: true, detail: { kind: "plugin", pluginId: "studio", tab: { id: "thread" }, params: { threadId: "thr_other" } } };
    state.tabs.push({ key: "k1", title: "a.ts", closable: true, detail: { kind: "file", path: "a.ts" } }, marked);
    state.selectedKey = "k1";
    const renamed: unknown[] = [];
    expect(clearSeenMark(wb, (tab) => renamed.push(tab))).toBe(false);
    state.selectedKey = "k2";
    state.layout.panel = "closed";
    expect(clearSeenMark(wb, (tab) => renamed.push(tab))).toBe(false);
    state.layout.panel = "open";
    expect(clearSeenMark(wb, (tab) => renamed.push(tab))).toBe(true);
    expect(renamed).toEqual([{ tabId: "thread", params: { threadId: "thr_other" }, title: "Release notes" }]);
  });

  it("doesn't reopen what the user closed after the agent opened it, unless forced", async () => {
    const { wb } = fakeWorkbench();
    const { call } = harness({ thr_1: wb });
    await call("workbench_open", { type: "page", id: "pg_plan" });
    wb.close("k1");
    expect(await call("workbench_open", { type: "page", id: "pg_plan" })).toBe('Not reopened: the user closed or moved "Plan" after you opened it. Pass force: true only when the user asks for it.');
    expect(wb.list().tabs).toEqual([]);
    expect(await call("workbench_list", {})).toContain('Closed or moved by the user after you opened them (not reopened without force): "Plan".');
    expect(await call("workbench_open", { type: "page", id: "pg_plan", force: true })).toBe('Opened "Plan" (key "k2") and selected it.');
  });

  it("lets the agent reopen what it closed itself, and what the user opened again", async () => {
    const { wb } = fakeWorkbench();
    const { call } = harness({ thr_1: wb });
    await call("workbench_open", { type: "page", id: "pg_plan" });
    expect(await call("workbench_close", { key: "k1" })).toBe('Closed "Plan".');
    expect(await call("workbench_open", { type: "page", id: "pg_plan" })).toBe('Opened "Plan" (key "k2") and selected it.');
    wb.close("k2");
    await wb.open({ kind: "tab", tab: { id: "studio" }, params: { kind: "page", id: "pg_plan" }, title: "Plan" }, { focus: false });
    expect(await call("workbench_open", { type: "page", id: "pg_plan" })).toBe('"Plan" was already open (key "k3"); selected it.');
  });

  it("keeps a closed panel closed when the user closed it after the agent opened it", async () => {
    const { wb, state } = fakeWorkbench();
    state.layout.panel = "closed";
    const { call } = harness({ thr_1: wb });
    await call("workbench_open", { type: "page", id: "pg_plan" });
    state.layout.panel = "closed";
    expect(await call("workbench_open", { type: "conversation", id: "thr_other" })).toBe('Opened "Release notes" (key "k2") behind the selected tab, marked new: the user closed the panel, so it stays closed.');
    expect(state.layout.panel).toBe("closed");
    expect(await call("workbench_arrange", { layout: "side by side" })).toMatch(/^Panel closed, 40% wide, conversation shown\. Left as the user set it: the panel open or closed\./);
    expect(await call("workbench_arrange", { layout: "side by side", force: true })).toBe("Panel open, 40% wide, conversation shown.");
  });
});

describe("arranging", () => {
  it("only sets side by side, panel only or conversation only, and a width of 20 to 80", async () => {
    const { wb, state } = fakeWorkbench();
    const { call, tools, published } = harness({ thr_1: wb });
    const arrange = tools.find((tool) => tool.name === "workbench_arrange")!;
    expect(arrange.parameters.safeParse({ widthPercent: 10 }).success).toBe(false);
    expect(arrange.parameters.safeParse({ widthPercent: 81 }).success).toBe(false);
    expect(await call("workbench_arrange", { layout: "stacked", widthPercent: 50 })).toBe(STACKED);
    expect(published).toEqual([]);
    expect(await call("workbench_arrange", { layout: "panel only", widthPercent: 60 })).toBe("Panel open, 60% wide, conversation collapsed.");
    expect(state.layout).toEqual({ panel: "open", widthPercent: 60, conversation: "collapsed" });
  });

  it("leaves a width the user changed after the agent set it, unless forced", async () => {
    const { wb, state } = fakeWorkbench();
    const { call } = harness({ thr_1: wb });
    await call("workbench_arrange", { widthPercent: 60 });
    state.layout.widthPercent = 35;
    expect(await call("workbench_arrange", { widthPercent: 60 })).toBe("Panel open, 35% wide, conversation shown. Left as the user set it: the panel width. Pass force: true only when the user asks for it.");
    expect(await call("workbench_arrange", { widthPercent: 60, force: true })).toBe("Panel open, 60% wide, conversation shown.");
  });

  it("doesn't close the panel while the user types in it", async () => {
    const { wb, state } = fakeWorkbench();
    state.typing = true;
    const { call } = harness({ thr_1: wb });
    expect(await call("workbench_arrange", { layout: "conversation only" })).toBe("Panel open, 40% wide, conversation shown. The panel stays open: the user is typing in it. Pass force: true only when the user asks for it.");
    expect(state.layout.panel).toBe("open");
  });
});

it("lists the tabs with their keys, the selected one, and which the agent opened", async () => {
  const { wb } = fakeWorkbench();
  await wb.open({ kind: "file", target: { kind: "workspace", environmentId: "env_1", path: "src/a.ts" } }, { focus: true });
  const { call } = harness({ thr_1: wb });
  await call("workbench_open", { type: "page", id: "pg_plan", focus: false });
  expect(await call("workbench_list", {})).toBe([
    "Panel open, 40% wide, conversation shown.",
    '- key "k1": "file" (file, selected)',
    `- key "k2": "${NEW_MARK}Plan" (Page, opened by you)`,
  ].join("\n"));
});

it("names a file by worktree path when it is in the worktree, else by full path on its machine", () => {
  const place = { environmentId: "env_1", hostId: "host_1", root: "/work/repo" };
  expect(fileTargetIn(place, "host_main", "src/a.ts")).toEqual({ kind: "workspace", environmentId: "env_1", path: "src/a.ts" });
  expect(fileTargetIn(place, "host_main", "/work/repo/src/a.ts")).toEqual({ kind: "workspace", environmentId: "env_1", path: "src/a.ts" });
  expect(fileTargetIn(place, "host_main", "/etc/hosts")).toEqual({ kind: "host", hostId: "host_1", path: "/etc/hosts" });
  expect(fileTargetIn({ environmentId: null, hostId: null, root: null }, "host_main", "src/a.ts")).toBeNull();
  expect(fileTargetIn({ environmentId: null, hostId: null, root: null }, "host_main", "/tmp/x")).toEqual({ kind: "host", hostId: "host_main", path: "/tmp/x" });
});

it("tells the agent when the window doesn't finish in time", async () => {
  const router = new WorkbenchRouter((command) => { router.claim(command.requestId); }, { claimMs: 1000, resultMs: 20 });
  const tools = workbenchTools({ router, records: new WorkbenchRecords(), threadTitle: async () => null, itemTitle: () => null, botName: () => null, entryTitle: async () => null, fileTarget: async () => null, workspacePath: async (_t, path) => path });
  expect(await (tools[0]!.execute as (input: object, ctx: { threadId: string }) => Promise<string>)({}, { threadId: "thr_1" })).toBe(NO_ANSWER);
});

/** A workbench with BB's two panes: each pane's tab keys and its share of the workbench. */
function twoPaneWorkbench() {
  const { wb, state } = fakeWorkbench();
  const panes = { strips: [[] as string[]], widths: [100] as number[] };
  const opens: { pane?: unknown; index?: unknown }[] = [];
  const base = { ...wb };
  const paned: WorkbenchLike = {
    ...base,
    open: async (spec, options) => {
      opens.push({ pane: options.pane, index: options.index });
      const key = await base.open(spec, options);
      if (!key || panes.strips.some((strip) => strip.includes(key))) return key;
      if (options.pane === "new" && panes.strips.length === 1) { panes.strips.push([]); panes.widths = [50, 50]; }
      const strip = panes.strips[options.pane === 2 || options.pane === "new" ? 1 : 0] ?? panes.strips[0]!;
      strip.splice(options.index ?? strip.length, 0, key);
      return key;
    },
    layout: () => ({ ...base.layout(), panes: panes.strips.length as 1 | 2, ...(panes.strips.length === 2 ? { paneWidths: [panes.widths[0]!, panes.widths[1]!] as [number, number] } : {}) }),
    paneOf: (key) => { const at = panes.strips.findIndex((strip) => strip.includes(key)); return at < 0 ? null : (at + 1) as 1 | 2; },
    arrange: (layout) => {
      if (layout.panes === 2 && panes.strips.length === 1) { panes.strips.push([]); panes.widths = [50, 50]; }
      if (layout.panes === 1 && panes.strips.length === 2) { panes.strips = [[...panes.strips[0]!, ...panes.strips[1]!]]; panes.widths = [100]; }
      if (layout.paneWidths) panes.widths = [...layout.paneWidths];
      const { panes: _panes, paneWidths: _widths, ...rest } = layout;
      return base.arrange(rest);
    },
  };
  return { wb: paned, state, panes, opens };
}

describe("two workbench panes", () => {
  it("opens in the pane and at the place the agent asks, making the second pane with \"new\"", async () => {
    const { wb, panes, opens } = twoPaneWorkbench();
    const { call } = harness({ thr_1: wb });
    expect(await call("workbench_open", { type: "page", id: "pg_plan" })).toBe('Opened "Plan" (key "k1") and selected it.');
    expect(await call("workbench_open", { type: "conversation", id: "thr_other", pane: "new" })).toBe('Opened "Release notes" (key "k2") in pane 2 and selected it.');
    expect(await call("workbench_open", { type: "memory", pane: 1, index: 0 })).toBe('Opened "Memory" (key "k3") in pane 1 and selected it.');
    expect(panes.strips).toEqual([["k3", "k1"], ["k2"]]);
    expect(opens.slice(1)).toEqual([{ pane: "new", index: undefined }, { pane: 1, index: 0 }]);
    expect(await call("workbench_list", {})).toBe([
      "Panel open, 40% wide, 2 panes (50% and 50%), conversation shown.",
      '- key "k1": "Plan" (Page, pane 1, opened by you)',
      '- key "k2": "Release notes" (Conversation, pane 2, opened by you)',
      '- key "k3": "Memory" (Memory, pane 1, selected, opened by you)',
    ].join("\n"));
  });

  it("opens in the one pane, and says so, on a BB whose workbench has no second pane", async () => {
    const { wb, state } = fakeWorkbench();
    const { call } = harness({ thr_1: wb });
    expect(await call("workbench_open", { type: "page", id: "pg_plan", pane: "new" })).toBe("Opened \"Plan\" (key \"k1\") and selected it. This BB's workbench has one pane. Opened it there.");
    expect(state.opened[0]!.focus).toBe(true);
  });

  it("makes no second pane while the user types in the workbench, or after they closed it, unless forced", async () => {
    const { wb, state, panes } = twoPaneWorkbench();
    const { call } = harness({ thr_1: wb });
    state.typing = true;
    expect(await call("workbench_open", { type: "page", id: "pg_plan", pane: "new" })).toMatch(/No second pane: the user is typing in the workbench\.$/);
    expect(panes.strips).toHaveLength(1);
    state.typing = false;
    await call("workbench_arrange", { panes: 2 });
    wb.arrange({ panes: 1 });
    expect(await call("workbench_open", { type: "conversation", id: "thr_other", pane: "new" })).toMatch(/No second pane: the user closed it\./);
    expect(await call("workbench_open", { type: "memory", pane: "new", force: true })).toMatch(/^Opened "Memory" \(key "k3"\) in pane 2/);
  });

  it("sets two panes and their widths, within the workbench's limits", async () => {
    const { wb, panes } = twoPaneWorkbench();
    const { call, tools } = harness({ thr_1: wb });
    const arrange = tools.find((tool) => tool.name === "workbench_arrange")!;
    expect(arrange.parameters.safeParse({ panes: 3 }).success).toBe(false);
    expect(arrange.parameters.safeParse({ paneWidths: [0, 1] }).success).toBe(false);
    expect(await call("workbench_arrange", { paneWidths: [60, 40] })).toBe("Pane widths need two panes: pass panes: 2 as well. Nothing changed.");
    expect(await call("workbench_arrange", { panes: 2, paneWidths: [9, 1] })).toBe("Pane widths are a ratio of two positive numbers, such as [2, 1]; each pane keeps at least 15% of the workbench. Nothing changed.");
    expect(await call("workbench_arrange", { panes: 2, paneWidths: [60, 40] })).toBe("Panel open, 40% wide, 2 panes (60% and 40%), conversation shown.");
    expect(panes.widths).toEqual([60, 40]);
    expect(await call("workbench_arrange", { layout: "stacked" })).toBe(STACKED);
    expect(STACKED).toContain("at most two panes, side by side, and the conversation stays on the left; panes don't stack");
  });

  it("refuses panes on a BB whose workbench has one", async () => {
    const { wb, state } = fakeWorkbench();
    const { call } = harness({ thr_1: wb });
    expect(await call("workbench_arrange", { panes: 2 })).toBe(`This BB's workbench has one pane. ${PANE_LIMITS} Nothing changed.`);
    expect(await call("workbench_arrange", { panes: 1 })).toBe("Panel open, 40% wide, conversation shown.");
    expect(state.layout).toEqual({ panel: "open", widthPercent: 40, conversation: "shown" });
  });

  it("reads BB's layout as a pane count and widths, and asks Visual Chat for its board only where BB declines it", async () => {
    const opened: unknown[] = [];
    const host: HostWorkbenchLike = {
      list: () => ({ open: true, selectedKey: "a", tabs: [] }),
      // A BB from before experimental_openableByPlugins: it knows no "board" tab of Studio's.
      open: async (spec) => { opened.push(["bb", spec]); return spec.kind === "tab" && spec.tab.id === "board" ? null : "k"; },
      close: () => true, focus: () => true, isTyping: () => false, arrange: () => true,
      layout: () => ({ panel: "open", widthPercent: 50, conversation: "shown", panes: [{ tabs: ["a"], widthPercent: 30 }, { tabs: ["b", "c"], widthPercent: 70 }] }),
    };
    const wb = adaptWorkbench(host, async (spec, options) => { opened.push(["sibling", spec.tab, options]); return "board-key"; });
    expect(wb.layout()).toEqual({ panel: "open", widthPercent: 50, conversation: "shown", panes: 2, paneWidths: [30, 70] });
    expect([wb.paneOf!("a"), wb.paneOf!("c"), wb.paneOf!("z")]).toEqual([1, 2, null]);
    expect(adaptLayout({ panel: "closed", widthPercent: 40, conversation: "shown" })).toEqual({ panel: "closed", widthPercent: 40, conversation: "shown" });
    expect(await wb.open({ kind: "tab", tab: { id: "board", pluginId: "studio-visual-chat" }, params: { threadId: "thr_b" } }, { focus: true, pane: 2 })).toBe("board-key");
    expect(await wb.open({ kind: "tab", tab: { id: "studio" } }, { focus: true })).toBe("k");
    expect(opened).toEqual([
      ["bb", { kind: "tab", tab: { id: "board", pluginId: "studio-visual-chat" }, params: { threadId: "thr_b" } }],
      ["sibling", { id: "board", pluginId: "studio-visual-chat" }, { focus: true, pane: 2 }],
      ["bb", { kind: "tab", tab: { id: "studio" } }],
    ]);
  });
});

describe("workbench_open's types come from the tab kinds registry", () => {
  it("takes every kind the agent may open, and nothing else", () => {
    const { tools } = harness({});
    const open = tools.find((tool) => tool.name === "workbench_open")!;
    const types = TAB_KIND_REGISTRY.flatMap((entry) => (entry.agentType ? [entry.agentType] : []));
    for (const type of types) expect(open.parameters.safeParse({ type }).success, type).toBe(true);
    expect(open.parameters.safeParse({ type: "thread" }).success).toBe(false);
    expect(open.parameters.safeParse({ type: "page", pane: 3 }).success).toBe(false);
    expect(open.parameters.safeParse({ type: "page", pane: "new", index: 0 }).success).toBe(true);
    expect(TAB_KIND_REGISTRY.filter((entry) => entry.surfaces.workbenchOpen !== "had" && entry.surfaces.workbenchOpen !== "added").map((entry) => entry.id)).toEqual(["terminal"]);
  });

  it("opens every Studio kind as its tab, and a board as Visual Chat's", async () => {
    const deps = { threadTitle: async (id: string) => (id === "thr_b" ? "Election night" : null), itemTitle: (id: string) => (id === "dsh_0123456789abcdef" ? "Sales" : null), botName: (id: string) => (id === "bot_main" ? "Chief of Staff" : null), entryTitle: async (kind: string, id: string) => (`${kind}/${id}` === "todo/loop_1" ? "Pay the bill" : `${kind}/${id}` === "automation/bot_main:heartbeat" ? "Check-in" : null) } as unknown as WorkbenchToolDeps;
    const spec = async (input: object) => { const op = await openOp(input as never, "thr_1", deps); return typeof op === "string" ? op : op.type === "open" ? op.spec : op; };
    expect(await spec({ type: "dashboard", id: "dsh_0123456789abcdef" })).toEqual({ kind: "tab", tab: { id: "studio" }, params: { kind: "dashboard", id: "dsh_0123456789abcdef" }, title: "Sales" });
    expect(await spec({ type: "board", id: "thr_b" })).toEqual({ kind: "tab", tab: { id: "board", pluginId: "studio-visual-chat" }, params: { threadId: "thr_b" }, title: "Election night" });
    expect(await spec({ type: "bot", id: "bot_main" })).toEqual({ kind: "tab", tab: { id: "bot" }, params: { botId: "bot_main" }, title: "Chief of Staff" });
    expect(await spec({ type: "archive", id: "bot_main" })).toEqual({ kind: "tab", tab: { id: "archive" }, params: { botId: "bot_main" }, title: "Archive" });
    expect(await spec({ type: "todos" })).toEqual({ kind: "tab", tab: { id: "loops" }, title: "Todos" });
    expect(await spec({ type: "vscode" })).toEqual({ kind: "tab", tab: { id: "code" }, title: "VS Code" });
    expect(await spec({ type: "workflow", id: "wfr_0123abcd" })).toEqual({ kind: "tab", tab: { id: "workflow-run", pluginId: "workflows" }, params: { runId: "wfr_0123abcd" }, title: "Workflow run" });
    expect(await spec({ type: "workflow", id: "nope" })).toBe("BB can't open that workflow run as a tab.");
    expect(await spec({ type: "memory", id: "bot_gone" })).toBe("No Bot has id bot_gone.");
    expect(await spec({ type: "dashboard", id: "pg_plan" })).toBe("No dashboard has id pg_plan.");
    expect(await spec({ type: "todo", id: "loop_1" })).toEqual({ kind: "tab", tab: { id: "todo" }, params: { id: "loop_1" }, title: "Pay the bill" });
    expect(await spec({ link: "bb://automation/bot_main%3Aheartbeat" })).toEqual({ kind: "tab", tab: { id: "automation" }, params: { id: "bot_main:heartbeat" }, title: "Check-in" });
    expect(await spec({ link: "/plugins/studio/studio/todo/loop_1" })).toEqual({ kind: "tab", tab: { id: "todo" }, params: { id: "loop_1" }, title: "Pay the bill" });
    expect(await spec({ type: "todo", id: "loop_gone" })).toBe("No todo has id loop_gone.");
    expect(await spec({ type: "record", id: "mem_gone" })).toBe("No memory record has id mem_gone.");
    expect(await spec({ type: "automation" })).toBe("Give the automation's id.");
  });

  it("takes a link instead of type and id: bb://, a BB address, a card directive, a file:// or an http(s) URL", async () => {
    const deps = {
      threadTitle: async (id: string) => (id === "thr_b" ? "Election night" : null),
      itemTitle: (id: string) => (id === "dsh_0123456789abcdef" ? "Sales" : null),
      botName: (id: string) => (id === "bot_main" ? "Chief of Staff" : null),
      fileTarget: async (_threadId: string, path: string) => ({ kind: "host" as const, hostId: "h1", path }),
      workspacePath: async (_threadId: string, path: string) => path,
    } as unknown as WorkbenchToolDeps;
    const spec = async (input: object) => { const op = await openOp(input as never, "thr_1", deps); return typeof op === "string" ? op : op.type === "open" ? op.spec : op; };
    expect(await spec({ link: "bb://dashboard/dsh_0123456789abcdef" })).toEqual({ kind: "tab", tab: { id: "studio" }, params: { kind: "dashboard", id: "dsh_0123456789abcdef" }, title: "Sales" });
    expect(await spec({ link: "/plugins/studio/studio/apps/dsh_0123456789abcdef" })).toEqual({ kind: "tab", tab: { id: "studio" }, params: { kind: "dashboard", id: "dsh_0123456789abcdef" }, title: "Sales" });
    expect(await spec({ link: "::dashboard{id=\"dsh_0123456789abcdef\"}" })).toEqual({ kind: "tab", tab: { id: "studio" }, params: { kind: "dashboard", id: "dsh_0123456789abcdef" }, title: "Sales" });
    expect(await spec({ link: "bb://conversation/thr_b", pane: 2 })).toEqual({ kind: "tab", tab: { id: "thread" }, params: { threadId: "thr_b" }, title: "Election night" });
    expect(await spec({ link: "bb://memory/bot_main" })).toEqual({ kind: "tab", tab: { id: "memory" }, params: { botId: "bot_main" }, title: "Memory" });
    expect(await spec({ link: "bb://vscode" })).toEqual({ kind: "tab", tab: { id: "code" }, title: "VS Code" });
    expect(await spec({ link: "file:///Users/p/a.ts" })).toEqual({ kind: "file", target: { kind: "host", hostId: "h1", path: "/Users/p/a.ts" }, location: null });
    expect(await spec({ link: "https://example.com/docs" })).toEqual({ kind: "url", url: "https://example.com/docs" });
    expect(await spec({ link: "bb://page/pg_gone" })).toBe("No page has id pg_gone.");
    expect(await spec({ link: "bb://terminal" })).toBe("Terminals can't be opened by link.");
    expect(await spec({ link: "nonsense" })).toMatch(/isn't a link to anything BB can open/);
    expect(await spec({})).toBe("Give a type, or a link.");
    expect(await spec({ type: "page", link: "bb://conversation/thr_b" })).toEqual({ kind: "tab", tab: { id: "thread" }, params: { threadId: "thr_b" }, title: "Election night" });
  });
});

it("asks BB for pane 2 as a new pane when there is one, and opens where tabs open when BB can't place it", async () => {
  const { wb, opens, panes } = twoPaneWorkbench();
  const { call } = harness({ thr_1: wb });
  expect(await call("workbench_open", { type: "page", id: "pg_plan", pane: 2 })).toBe('Opened "Plan" (key "k1") in pane 2 and selected it.');
  expect(opens[0]).toEqual({ pane: "new", index: undefined });
  expect(panes.strips).toEqual([[], ["k1"]]);
  const declining: WorkbenchLike = { ...wb, open: (spec, options) => (options.pane !== undefined ? Promise.resolve(null) : wb.open(spec, options)) };
  const second = harness({ thr_1: declining });
  expect(await second.call("workbench_open", { type: "conversation", id: "thr_other", pane: 1, index: 0 })).toMatch(/^Opened "Release notes" \(key "k2"\).* BB couldn't place it there; opened it in the pane in use\.$/);
});

it("opens a workflow run as the Workflows plugin's tab and lists it by kind", async () => {
  const { wb, state } = fakeWorkbench();
  const { call } = harness({ thr_1: wb });
  expect(await call("workbench_open", { type: "workflow", id: "wfr_0123abcd" })).toBe('Opened "Workflow run" (key "k1") and selected it.');
  expect(state.opened[0]!.spec).toEqual({ kind: "tab", tab: { id: "workflow-run", pluginId: "workflows" }, params: { runId: "wfr_0123abcd" }, title: "Workflow run" });
  expect(await call("workbench_list", {})).toBe('Panel open, 40% wide, conversation shown.\n- key "k1": "Workflow run" (Workflow run, selected, opened by you)');
  expect(await call("workbench_open", { type: "workflow", id: "wfr_0123abcd" })).toBe('"Workflow run" was already open (key "k1"); selected it.');
});

function windowWorkbench(answer = true) {
  const { wb, state } = fakeWorkbench();
  const popped: string[] = [];
  const windowed: WorkbenchLike = {
    ...wb,
    popOut: async (key) => {
      popped.push(key);
      if (!answer) return false;
      wb.close(key);
      return true;
    },
  };
  return { wb: windowed, state, popped };
}

describe("a tab in a window of its own", () => {
  it("workbench_open with pane \"window\" opens it, then pops it out, and the record doesn't count it as closed by the user", async () => {
    const { wb, state, popped } = windowWorkbench();
    const { call } = harness({ thr_1: wb });
    expect(await call("workbench_open", { type: "page", id: "pg_plan", pane: "window" })).toBe('Opened "Plan" in a window of its own. Its Return to workbench button puts it back.');
    expect(state.opened).toEqual([{ spec: { kind: "tab", tab: { id: "studio" }, params: { kind: "page", id: "pg_plan" }, title: "Plan" }, focus: false }]);
    expect(popped).toEqual(["k1"]);
    expect(state.tabs).toEqual([]);
    expect(await call("workbench_list", {})).toBe("Panel open, 40% wide, conversation shown.\nNo tabs open.");
    expect(await call("workbench_open", { type: "page", id: "pg_plan" })).toBe('Opened "Plan" (key "k2") and selected it.');
  });

  it("refuses kinds that can't be shown alone: diffs and browser tabs by type, terminals, Info, New Tab and fixed tabs by key", async () => {
    const { wb, state, popped } = windowWorkbench();
    const { call } = harness({ thr_1: wb });
    expect(await call("workbench_open", { type: "diff", path: "src/a.ts", pane: "window" })).toMatch(/^Diffs can't open in windows of their own\. .*terminals, browser tabs, Info, Diff, New Tab and fixed tabs stay in the workbench\.$/);
    expect(await call("workbench_open", { type: "url", url: "https://example.com", pane: "window" })).toMatch(/^Browser tabs can't open in windows of their own\./);
    state.tabs.push(
      { key: "term", title: "zsh", closable: true, detail: { kind: "terminal", terminalId: "t1" } },
      { key: "info", title: "Info", closable: false, detail: { kind: "info" } },
      { key: "new", title: "New Tab", closable: true, detail: { kind: "new-tab" } },
      { key: "fixed", title: "Bot", closable: false, detail: { kind: "plugin", pluginId: "studio", tab: { id: "bot" }, params: null } },
      { key: "web", title: "Docs", closable: true, detail: { kind: "browser", url: "https://example.com" } },
      { key: "board", title: "Election night", closable: true, detail: { kind: "plugin", pluginId: "studio-visual-chat", tab: { id: "board" }, params: { threadId: "thr_b" } } },
    );
    for (const key of ["term", "info", "new", "fixed", "web"]) expect(await call("workbench_pop_out", { key })).toMatch(/can't open in a window of its own\. Pages, whiteboards/);
    expect(popped).toEqual([]);
    expect(await call("workbench_pop_out", { key: "gone" })).toBe('No tab has key "gone". Call workbench_list for the current keys.');
    expect(await call("workbench_pop_out", { key: "board" })).toBe('Opened "Election night" in a window of its own. Its Return to workbench button puts it back.');
    expect(popped).toEqual(["board"]);
  });

  it("stays in the workbench while the user types, where BB declines, and on a BB without windows", async () => {
    const typing = windowWorkbench();
    typing.state.typing = true;
    const first = harness({ thr_1: typing.wb });
    expect(await first.call("workbench_open", { type: "page", id: "pg_plan", pane: "window" })).toBe(`Opened "Plan" (key "k1") behind the selected tab, marked new: the user is typing in the panel. Not in a window: the user is typing in the workbench. Pass force: true only when the user asks for it.`);
    expect(typing.popped).toEqual([]);
    expect(await first.call("workbench_pop_out", { key: "k1" })).toMatch(/^Not opened in a window: the user is typing/);
    expect(await first.call("workbench_pop_out", { key: "k1", force: true })).toMatch(/^Opened ".*Plan" in a window of its own/);
    const declined = windowWorkbench(false);
    expect(await harness({ thr_1: declined.wb }).call("workbench_open", { type: "conversation", id: "thr_other", pane: "window" })).toMatch(/^"Release notes" is in the workbench \(key "k1"\): BB didn't open it in a window of its own\./);
    const { wb } = fakeWorkbench();
    expect(await harness({ thr_1: wb }).call("workbench_open", { type: "page", id: "pg_plan", pane: "window" })).toBe("Opened \"Plan\" (key \"k1\") and selected it. This BB can't open workbench tabs in windows of their own.");
    expect(await harness({ thr_1: wb }).call("workbench_pop_out", { key: "k1" })).toBe("This BB can't open workbench tabs in windows of their own.");
  });

  it("passes BB's popOut through, where BB has it", async () => {
    const host = { list: () => ({ open: true, selectedKey: null, tabs: [] }), open: async () => null, close: () => false, focus: () => false, layout: () => ({ panel: "open" as const, widthPercent: 40, conversation: "shown" as const }), arrange: () => false, isTyping: () => false };
    expect(adaptWorkbench(host).popOut).toBeUndefined();
    const popOut = async (key: string) => key === "k1";
    expect(await adaptWorkbench({ ...host, popOut } as HostWorkbenchLike).popOut!("k1")).toBe(true);
  });
});
