import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_TAB } from "./kit/code-contract";
import { dragItemRef, linkDragItem, refDragItem } from "./kit/app/item-drag";
import { LOOPS_PANE } from "./loops/ui/hooks";
import {
  AGENT_TYPES, auditTable, itemKindOfId, kindsNamedBy, NEW_TAB_ACTIONS, newTabFields, newTabTitle, pathFor, refOfPath, refOfTab, SURFACES,
  TAB_IDS, TAB_KIND_REGISTRY, tabKindEntry, tabOpenFor, type TabKindId, type TabRef,
} from "./tab-kinds";
import { STUDIO_TAB } from "./ui/studio-tab/model";

/** One of each kind, as a surface would name it. */
const SAMPLE: Record<TabKindId, TabRef> = {
  conversation: { kind: "conversation", id: "thr_1" },
  worker: { kind: "worker", id: "thr_2" },
  bot: { kind: "bot", id: "bot_main" },
  page: { kind: "page", id: "pg_0123456789abcdef" },
  whiteboard: { kind: "whiteboard", id: "drw_0123456789abcdef" },
  design: { kind: "design", id: "dsn_0123456789abcdef" },
  app: { kind: "app", id: "mini_0123456789abcdef" },
  dashboard: { kind: "dashboard", id: "dsh_0123456789abcdef" },
  artifact: { kind: "artifact", id: "art_0123456789abcdef" },
  recording: { kind: "recording", id: "rec_0123456789" },
  board: { kind: "board", id: "thr_board" },
  memory: { kind: "memory", id: "bot_main" },
  library: { kind: "library", id: null },
  automations: { kind: "automations", id: null },
  todos: { kind: "todos", id: "bot_main" },
  archive: { kind: "archive", id: "bot_main" },
  automation: { kind: "automation", id: "bot_main:aut_0123456789abcdef" },
  todo: { kind: "todo", id: "loop_0123abcd" },
  record: { kind: "record", id: "mem_0123456789abcdef" },
  vscode: { kind: "vscode", id: null },
  file: { kind: "file", id: "src/a.ts" },
  diff: { kind: "diff", id: "src/a.ts" },
  browser: { kind: "browser", id: "https://example.com" },
  terminal: { kind: "terminal", id: null },
  workflow: { kind: "workflow", id: "wfr_0123abcd" },
};

const reaches = (status: unknown) => status === "had" || status === "added";
const studioSide = TAB_KIND_REGISTRY.filter((entry) => entry.owner !== "bb");
/** A thread is a conversation to every surface that reads an address or a tab. */
const sameKind = (a: TabKindId, b: TabKindId | undefined) => a === b || (a === "worker" && b === "conversation");

describe("the registry", () => {
  it("names every kind once, and says for every surface whether it reaches it, with a reason where it can't", () => {
    expect(new Set(TAB_KIND_REGISTRY.map((entry) => entry.id)).size).toBe(TAB_KIND_REGISTRY.length);
    expect(Object.keys(SAMPLE).sort()).toEqual(TAB_KIND_REGISTRY.map((entry) => entry.id).sort());
    for (const entry of TAB_KIND_REGISTRY) {
      expect(entry.name && entry.plural && entry.icon, entry.id).toBeTruthy();
      for (const surface of SURFACES) {
        const status = entry.surfaces[surface];
        expect(reaches(status) || (typeof status === "object" && status.na.length > 10), `${entry.id} ${surface}`).toBe(true);
      }
    }
  });

  it("covers the kinds the owner listed, and bb's own", () => {
    const names = TAB_KIND_REGISTRY.map((entry) => entry.name);
    for (const name of ["Conversation", "Worker", "Page", "Whiteboard", "Design", "Visual Chat board", "Artifact", "App", "Dashboard", "Memory", "Library", "Automations", "Todos", "Archive", "VS Code", "File", "Diff", "Browser", "Workflow run"]) expect(names).toContain(name);
    expect(TAB_KIND_REGISTRY.filter((entry) => entry.owner === "bb").map((entry) => entry.open)).toEqual([
      { via: "bb", spec: "file" }, { via: "bb", spec: "diff" }, { via: "bb", spec: "url" }, { via: "bb", spec: "terminal" },
      // The Workflows plugin lets other plugins open its run tab.
      { via: "plugin", pluginId: "workflows", tabId: "workflow-run" },
    ]);
  });

  it("uses the tab ids the tabs register with", () => {
    expect([TAB_IDS.studio, TAB_IDS.code, TAB_IDS.todos]).toEqual([STUDIO_TAB, CODE_TAB, LOOPS_PANE]);
  });
});

describe("every kind reaches every surface it claims", () => {
  it("New tab: an Action, or rows in Studio's search", () => {
    for (const entry of studioSide.filter((each) => reaches(each.surfaces.newTab))) {
      const action = NEW_TAB_ACTIONS.some((each) => each.kind === entry.id);
      expect(action || entry.recents !== null, entry.id).toBe(true);
    }
  });

  it("Recent: a listing the server or this window keeps", () => {
    for (const entry of studioSide.filter((each) => reaches(each.surfaces.recent))) expect(entry.recents, entry.id).not.toBeNull();
    expect(tabKindEntry("file").recents).toBe("bb");
  });

  it("Sidebar drag: a row it drags from, and a payload that reads back as the kind", () => {
    for (const entry of TAB_KIND_REGISTRY.filter((each) => reaches(each.surfaces.sidebarDrag))) {
      expect(entry.dragFrom, entry.id).not.toBeNull();
      const item = refDragItem(SAMPLE[entry.id], "Title");
      expect(item, entry.id).not.toBeNull();
      expect(sameKind(entry.id, dragItemRef(item!)?.kind), entry.id).toBe(true);
    }
  });

  it("workbench_open: a type, and for Studio's kinds the tab that shows it", () => {
    for (const entry of TAB_KIND_REGISTRY.filter((each) => reaches(each.surfaces.workbenchOpen))) {
      expect(AGENT_TYPES, entry.id).toContain(entry.agentType);
      if (entry.owner !== "bb" || entry.open.via === "plugin") expect(tabOpenFor(SAMPLE[entry.id]), entry.id).not.toBeNull();
    }
    for (const entry of TAB_KIND_REGISTRY.filter((each) => !reaches(each.surfaces.workbenchOpen))) expect(entry.agentType, entry.id).toBeNull();
  });

  it("Chat link: Studio's kinds have an address that reads back as the kind and drags as it", () => {
    for (const entry of studioSide.filter((each) => reaches(each.surfaces.chatLink))) {
      const path = pathFor(SAMPLE[entry.id]);
      expect(path, entry.id).not.toBeNull();
      expect(sameKind(entry.id, refOfPath(path!)?.kind), `${entry.id} ${path}`).toBe(true);
      expect(linkDragItem({ href: path!, title: "Title" }), entry.id).not.toBeNull();
    }
  });

  it("opens and reads back each Studio kind's tab", () => {
    for (const entry of studioSide) {
      const open = tabOpenFor(SAMPLE[entry.id], "Title")!;
      const back = refOfTab({ pluginId: open.pluginId, tabId: open.tabId, params: open.params });
      expect(sameKind(entry.id, back?.kind), entry.id).toBe(true);
    }
    expect(tabOpenFor({ kind: "page", id: "dsn_0123456789abcdef" })).toBeNull();
    expect(tabOpenFor({ kind: "conversation", id: null })).toBeNull();
    expect(tabOpenFor(SAMPLE.file)).toBeNull();
    expect(refOfTab({ pluginId: "studio", tabId: "thread", params: null })).toBeNull();
  });
});

describe("addresses", () => {
  it("reads every Studio address it writes, and nothing else", () => {
    expect(refOfPath("/projects/p_1/threads/thr_9/files")).toEqual({ kind: "conversation", id: "thr_9" });
    expect(refOfPath("/plugins/studio/studio/pages/dsn_0123456789abcdef")).toEqual({ kind: "design", id: "dsn_0123456789abcdef" });
    expect(refOfPath("/plugins/studio/studio/memory")).toEqual({ kind: "memory", id: null });
    expect(refOfPath("/plugins/studio/studio/bot/new")).toBeNull();
    expect(refOfPath("/plugins/studio/studio/automation/bot_main%3Aheartbeat")).toEqual({ kind: "automation", id: "bot_main:heartbeat" });
    expect(refOfPath("/plugins/studio/studio/todo/loop_1/extra")).toBeNull();
    expect(refOfTab({ pluginId: "studio", tabId: "todo", params: { id: "loop_1" } })).toEqual({ kind: "todo", id: "loop_1" });
    expect(refOfTab({ pluginId: "studio", tabId: "memory-record", params: null })).toBeNull();
    expect(refOfPath("/plugins/studio-visual-chat/canvas/new")).toBeNull();
    expect(refOfPath("/plugins/studio/studio/setup")).toBeNull();
    expect(refOfPath("/settings")).toBeNull();
    expect(itemKindOfId("rec_0123456789")).toBe("recording");
  });
});

describe("naming", () => {
  it("lists the New Tab Actions under New and Open, titled New <kind>, Open <kind> or the page's name", () => {
    expect(NEW_TAB_ACTIONS.map((action) => `${action.group}: ${action.title}`)).toEqual([
      "New: New conversation", "New: New page", "New: New whiteboard", "New: New design", "New: New app", "New: New dashboard",
      "Open: Open conversation", "Open: Open page", "Open: Memory", "Open: Library", "Open: Automations", "Open: Todos", "Open: Archive", "Open: VS Code",
    ]);
    // bb's action search lists matches under one heading: no two titles are the same.
    expect(new Set(NEW_TAB_ACTIONS.map((action) => action.title)).size).toBe(NEW_TAB_ACTIONS.length);
    expect(NEW_TAB_ACTIONS.some((action) => /^(Studio|Thread)$/.test(action.title))).toBe(false);
    expect(new Set(NEW_TAB_ACTIONS.map((action) => action.tabId)).size).toBe(NEW_TAB_ACTIONS.length);
    expect([newTabTitle("thread"), newTabTitle("studio"), newTabTitle("memory"), newTabTitle("bot")]).toEqual(["Open conversation", "Open page", "Memory", null]);
    expect(newTabFields("new-design")).toEqual({ experimental_newTabGroup: "New", tooltip: "New design" });
    expect(newTabFields("code")).toEqual({ experimental_newTabGroup: "Open", tooltip: "Open VS Code" });
    expect(newTabFields("bot")).toEqual({});
  });

  it("finds a kind by its name or plural in a search", () => {
    expect(kindsNamedBy("whiteboards")).toEqual(["whiteboard"]);
    expect(kindsNamedBy("Todo")).toEqual(["todos", "todo"]);
    expect(kindsNamedBy("memory records")).toEqual(["memory", "record"]);
    expect(kindsNamedBy("pa")).toEqual([]);
  });
});

it("keeps docs/tab-kinds-audit.md to the registry's table", () => {
  const doc = readFileSync(resolve(__dirname, "../docs/tab-kinds-audit.md"), "utf8");
  expect(doc).toContain(auditTable());
});
