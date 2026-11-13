// The one registry of what can be a tab in a conversation's workbench (the
// side panel beside the chat). Every surface that names, finds, drags or
// opens a tab reads it:
// - the New Tab page: its Actions (the action tabs' titles: "New page",
//   "Memory") and Studio's Recent rows and search results (src/newtab.ts,
//   src/ui/newtab-items.tsx);
// - drag and drop: the payload a row writes and what a drop opens
//   (src/kit/app/item-drag.ts, src/ui/item-drop.ts);
// - the agent's workbench_open: its `type` enum and what each type opens
//   (src/workbench-agent/server.ts);
// - links and cards in chat: which address is which kind
//   (src/links/router.ts, linkDragItem).
// bb's own kinds (file, diff, browser, terminal, workflow run) are listed so
// the audit (docs/tab-kinds-audit.md) covers them; Studio references them and
// never draws them. Pure: the server, the app and tests share it.
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { BUILTIN_ROUTES } from "./builtins";
import { CODE_ICON, CODE_TAB } from "./kit/code-contract";
import { STUDIO_TAB, TAB_KINDS, type TabKind as StudioTabKind } from "./ui/studio-tab/model";

export const STUDIO_PLUGIN = "studio";
export const VISUAL_CHAT_PLUGIN = "studio-visual-chat";
/** bb's bundled Workflows plugin, whose `workflow-run` tab (`{ runId }`) other plugins may open. */
export const WORKFLOWS_PLUGIN = "workflows";
export const WORKFLOW_RUN_TAB = "workflow-run";

/** Studio's action tab ids, beside STUDIO_TAB (src/ui/studio-tab) and CODE_TAB (src/code). */
export const TAB_IDS = {
  thread: "thread",
  bot: "bot",
  studio: STUDIO_TAB,
  code: CODE_TAB,
  todos: "loops",
  memory: "memory",
  skills: "bot-skills",
  library: "library",
  automations: "bot-automations",
  archive: "archive",
  automation: "automation",
  todo: "todo",
  record: "memory-record",
  /** Visual Chat's own tab (packages/bb-studio-visual-chat): a board, `{ threadId }`. */
  board: "board",
} as const;

export type TabKindId =
  | "conversation" | "worker" | "bot"
  | "page" | "whiteboard" | "design" | "app" | "artifact" | "recording"
  | "board"
  | "memory" | "skills" | "library" | "automations" | "todos" | "archive"
  | "automation" | "todo" | "record"
  | "vscode"
  | "file" | "diff" | "browser" | "terminal" | "workflow";

/** One thing to open: its kind, and its id where the kind has one (a thread, an item, a Bot); null for a page with one per window. */
export interface TabRef { kind: TabKindId; id: string | null }

/** The surfaces the audit checks, in its column order. */
export const SURFACES = ["newTab", "recent", "sidebarDrag", "workbenchOpen", "chatLink"] as const;
export type Surface = (typeof SURFACES)[number];
export const SURFACE_NAMES: Record<Surface, string> = { newTab: "New tab", recent: "Recent", sidebarDrag: "Sidebar drag", workbenchOpen: "workbench_open", chatLink: "Chat link" };

/** Whether a surface reaches a kind: it did before the registry, it does now, or it can't (with why). */
export type SurfaceStatus = "had" | "added" | { na: string };

/** How a kind opens as a workbench tab. */
export type TabOpen =
  /** One of Studio's action tabs; `params` from the ref's id. */
  | { via: "studio"; tabId: string }
  /**
   * Another plugin's tab that it lets other plugins open
   * (`experimental_openableByPlugins`): Visual Chat's board, bb's workflow
   * run. The workbench API opens it with `tab.pluginId`.
   */
  | { via: "plugin"; pluginId: string; tabId: string }
  /** bb's own tab, opened through the workbench API's own spec, or not at all from a plugin. */
  | { via: "bb"; spec: "file" | "diff" | "url" | "terminal" | "plugin-tab" };

/** The New Tab page's headings for Studio's Actions (`experimental_newTabGroup`), in the order they are listed. */
export const NEW_TAB_GROUPS = ["New", "Open"] as const;
export type NewTabGroup = (typeof NEW_TAB_GROUPS)[number];

/** Where a kind's recent rows and search hits come from. */
export type Listing =
  /** The Bots' conversations and workers (the server's bot thread store). */
  | "bot-threads"
  /** Studio's items index and search index. */
  | "items"
  /** Visual Chat's boards (its `canvas.list`). */
  | "boards"
  /** The Bots, by name. */
  | "bots"
  /** This window's record of the tabs of this kind opened last (src/ui/opened-tabs.ts); search matches the kind's name. */
  | "opened"
  /** The Bot pages' rows (automations, todos, memory records), searched by title on the server. */
  | "entries"
  /** bb's own (its recent files, its file search). */
  | "bb";

export interface TabKindEntry {
  id: TabKindId;
  /** The kind noun: Recent's kind column, the agent's type, the New Tab Actions. */
  name: string;
  plural: string;
  /** A bb icon name. */
  icon: string;
  /** Whose kind it is. */
  owner: "studio" | "visual-chat" | "bb";
  /** What names one: a thread id, an item id, a Bot id, a workflow run id; "none" for a page of which there is one. */
  ref: "thread" | "item" | "bot" | "entry" | "run" | "none" | "path" | "url";
  open: TabOpen;
  /** The New Tab page's Actions for it, under the "New" heading (makes one) or "Open" (opens its page, or a picker); titled by the kind's name. */
  actions: readonly { tabId: string; group: NewTabGroup }[];
  /** The Studio list or sidebar row it is dragged from; null where it has none. */
  dragFrom: string | null;
  recents: Listing | null;
  /** The type workbench_open takes for it; null where the agent can't open it. */
  agentType: string | null;
  surfaces: Record<Surface, SurfaceStatus>;
}

/** The kinds the Studio tab shows (src/ui/studio-tab/model.ts TAB_KINDS), by registry id. */
export const ITEM_KINDS: readonly { id: TabKindId; tabKind: StudioTabKind }[] = [
  { id: "page", tabKind: "page" },
  { id: "whiteboard", tabKind: "drawing" },
  { id: "design", tabKind: "design" },
  { id: "app", tabKind: "mini" },
  { id: "artifact", tabKind: "artifact" },
  { id: "recording", tabKind: "recording" },
];

const STUDIO_ROOT = "/plugins/studio/studio";
const all = (status: SurfaceStatus): Record<Surface, SurfaceStatus> => ({ newTab: status, recent: status, sidebarDrag: status, workbenchOpen: status, chatLink: status });

const item = (id: TabKindId, name: string, plural: string, icon: string, surfaces: Partial<Record<Surface, SurfaceStatus>>, create: boolean, picker = false): TabKindEntry => ({
  id, name, plural, icon, owner: "studio", ref: "item", open: { via: "studio", tabId: STUDIO_TAB },
  actions: [
    ...(create ? [{ tabId: `new-${id}`, group: "New" as const }] : []),
    // The Studio tab opened bare lists every item, pages first.
    ...(picker ? [{ tabId: STUDIO_TAB, group: "Open" as const }] : []),
  ],
  dragFrom: "Library", recents: "items", agentType: id,
  surfaces: { newTab: "had", recent: "had", sidebarDrag: "added", workbenchOpen: "had", chatLink: "had", ...surfaces },
});

const botPage = (id: TabKindId, name: string, icon: string, tabId: string, chatLink: SurfaceStatus = "had"): TabKindEntry => ({
  id, name, plural: name, icon, owner: "studio", ref: "bot", open: { via: "studio", tabId },
  actions: [{ tabId, group: "Open" }], dragFrom: "Bot sidebar", recents: "opened", agentType: id,
  surfaces: { newTab: "added", recent: "added", sidebarDrag: "added", workbenchOpen: "added", chatLink },
});

const pageRow = (id: TabKindId, name: string, plural: string, icon: string, tabId: string, dragFrom: string): TabKindEntry => ({
  id, name, plural, icon, owner: "studio", ref: "entry", open: { via: "studio", tabId },
  actions: [], dragFrom, recents: "entries", agentType: id,
  surfaces: { newTab: "added", recent: { na: `${plural} change on their own and would crowd Recent; the New Tab search finds one.` }, sidebarDrag: "added", workbenchOpen: "added", chatLink: "added" },
});

const bb = (id: TabKindId, name: string, plural: string, icon: string, spec: Extract<TabOpen, { via: "bb" }>["spec"], agentType: string | null, surfaces: Record<Surface, SurfaceStatus>): TabKindEntry => ({
  id, name, plural, icon, owner: "bb", ref: id === "browser" ? "url" : id === "terminal" || id === "workflow" ? "none" : "path", open: { via: "bb", spec },
  actions: [], dragFrom: null, recents: id === "file" ? "bb" : null, agentType, surfaces,
});

export const TAB_KIND_REGISTRY: readonly TabKindEntry[] = [
  {
    id: "conversation", name: "Conversation", plural: "Conversations", icon: "MessageSquare", owner: "studio", ref: "thread", open: { via: "studio", tabId: TAB_IDS.thread },
    actions: [{ tabId: "new-conversation", group: "New" }, { tabId: TAB_IDS.thread, group: "Open" }],
    dragFrom: "Bot sidebar", recents: "bot-threads", agentType: "conversation", surfaces: all("had"),
  },
  {
    id: "worker", name: "Worker", plural: "Workers", icon: "Bot", owner: "studio", ref: "thread", open: { via: "studio", tabId: TAB_IDS.thread },
    actions: [], dragFrom: "Bot sidebar", recents: "bot-threads", agentType: "worker", surfaces: all("had"),
  },
  {
    id: "bot", name: "Bot", plural: "Bots", icon: "Bot", owner: "studio", ref: "bot", open: { via: "studio", tabId: TAB_IDS.bot },
    actions: [], dragFrom: "Bot switcher", recents: "bots", agentType: "bot",
    surfaces: { newTab: "added", recent: "added", sidebarDrag: "added", workbenchOpen: "added", chatLink: "had" },
  },
  item("page", "Page", "Pages", "FileText", {}, true, true),
  item("whiteboard", "Whiteboard", "Whiteboards", "Edit", {}, true),
  item("design", "Design", "Designs", "Palette", {}, true),
  item("app", "App", "Apps", "AppWindow", { newTab: "added", recent: "added", workbenchOpen: "added" }, true),
  item("artifact", "Artifact", "Apps", "studio/artifact", { newTab: "added", recent: "added", workbenchOpen: "added" }, false),
  item("recording", "Recording", "Recordings", "Mic", { newTab: "added", recent: "added", workbenchOpen: "added", sidebarDrag: { na: "The Library lists no recordings; drag one from the New Tab page's Recent or search, or Talk's Recordings page." } }, false),
  {
    id: "board", name: "Visual Chat board", plural: "Visual Chat boards", icon: "AppWindow", owner: "visual-chat", ref: "thread", open: { via: "plugin", pluginId: VISUAL_CHAT_PLUGIN, tabId: TAB_IDS.board },
    actions: [], dragFrom: null, recents: "boards", agentType: "board",
    surfaces: { newTab: "had", recent: "had", sidebarDrag: { na: "Boards have no row in Studio's sidebar; drag one from the New Tab page's Recent or search." }, workbenchOpen: "added", chatLink: "had" },
  },
  botPage("memory", "Memory", "Brain", TAB_IDS.memory),
  botPage("skills", "Skills", "Toolbox", TAB_IDS.skills, "added"),
  botPage("library", "Library", "studio/library", TAB_IDS.library),
  {
    ...botPage("automations", "Scheduled", "ListTodo", TAB_IDS.automations),
    actions: [], recents: null,
    surfaces: {
      newTab: { na: "The Todos page is the one entry; this address opens it at Scheduled." },
      recent: { na: "Recent lists the Todos page once, under Todos." },
      sidebarDrag: "added", workbenchOpen: "added", chatLink: "had",
    },
  },
  botPage("todos", "Todos", "ListTodo", TAB_IDS.todos),
  botPage("archive", "Archive", "Archive", TAB_IDS.archive),
  pageRow("automation", "Automation", "Automations", "Clock", TAB_IDS.automation, "Automations page"),
  pageRow("todo", "Todo", "Todos", "ListTodo", TAB_IDS.todo, "Todos page"),
  pageRow("record", "Memory record", "Memory records", "Brain", TAB_IDS.record, "Memory page"),
  {
    id: "vscode", name: "VS Code", plural: "VS Code", icon: CODE_ICON, owner: "studio", ref: "none", open: { via: "studio", tabId: CODE_TAB },
    actions: [{ tabId: CODE_TAB, group: "Open" }], dragFrom: null, recents: "opened", agentType: "vscode",
    surfaces: { newTab: "added", recent: "added", sidebarDrag: { na: "VS Code has no sidebar row; drag it from the New Tab page's Recent, or open it from the launcher or a file." }, workbenchOpen: "added", chatLink: "had" },
  },
  bb("file", "File", "Files", "File", "file", "file", { newTab: "had", recent: "had", sidebarDrag: { na: "bb's own: files are dragged from Finder, which bb attaches to the composer." }, workbenchOpen: "had", chatLink: "had" }),
  bb("diff", "Diff", "Diffs", "FileDiff", "diff", "diff", { newTab: { na: "bb's New Tab page lists no diffs; bb's Git panel opens them." }, recent: { na: "bb keeps no recent diffs." }, sidebarDrag: { na: "bb's own: no row." }, workbenchOpen: "had", chatLink: { na: "Replies don't link a diff; bb's change cards open it." } }),
  bb("browser", "Browser", "Browser tabs", "Globe", "url", "url", { newTab: "had", recent: { na: "bb keeps no recent browser tabs." }, sidebarDrag: { na: "bb's own: no row." }, workbenchOpen: "had", chatLink: "had" }),
  bb("terminal", "Terminal", "Terminals", "Terminal", "terminal", null, { newTab: "had", recent: { na: "bb keeps no recent terminals." }, sidebarDrag: { na: "bb's own: no row." }, workbenchOpen: { na: "A terminal opens by starting one; the agent has no terminal id to open. workbench_focus selects an open one." }, chatLink: { na: "Replies don't link a terminal." } }),
  {
    ...bb("workflow", "Workflow run", "Workflow runs", "Workflow", "plugin-tab", "workflow", { newTab: "had", recent: { na: "bb keeps no recent workflow runs." }, sidebarDrag: { na: "bb's own: no row." }, workbenchOpen: "added", chatLink: "had" }),
    // The Workflows plugin lets other plugins open its run tab (`experimental_openableByPlugins`).
    ref: "run", open: { via: "plugin", pluginId: WORKFLOWS_PLUGIN, tabId: WORKFLOW_RUN_TAB },
  },
];

const BY_ID = new Map(TAB_KIND_REGISTRY.map((entry) => [entry.id, entry]));

export function tabKindEntry(id: TabKindId): TabKindEntry {
  return BY_ID.get(id)!;
}

export const isTabKindId = (value: unknown): value is TabKindId => typeof value === "string" && BY_ID.has(value as TabKindId);

/** The types workbench_open takes, in registry order. */
export const AGENT_TYPES: readonly string[] = TAB_KIND_REGISTRY.flatMap((entry) => (entry.agentType ? [entry.agentType] : []));

export function kindOfAgentType(type: string): TabKindEntry | null {
  return TAB_KIND_REGISTRY.find((entry) => entry.agentType === type) ?? null;
}

/** The Studio tab kind an item id has, as the registry names it; null for any other id. Dictations are recordings. */
export function itemKindOfId(id: string): TabKindId | null {
  const info = TAB_KINDS.find((each) => each.kind !== "dictation" && each.isId(id));
  return info ? ITEM_KINDS.find((each) => each.tabKind === info.kind)?.id ?? null : null;
}

const studioTabKind = (kind: TabKindId) => ITEM_KINDS.find((each) => each.id === kind)?.tabKind ?? null;

/** A Studio action tab and its params, as `openTab` and the workbench's `open` take them. */
export interface StudioTabOpen { pluginId: string; tabId: string; params: JsonValue | null; title: string }

/**
 * The tab that shows `ref`: Studio's (or Visual Chat's) action tab and its
 * params. Null for bb's own kinds, an item id that isn't the kind's, and a
 * kind that needs an id without one.
 */
export function tabOpenFor(ref: TabRef, title?: string | null): StudioTabOpen | null {
  const entry = BY_ID.get(ref.kind);
  const how = entry?.open;
  if (!entry || !how || how.via === "bb") return null;
  const named = title?.trim() || entry.name;
  const pluginId = how.via === "plugin" ? how.pluginId : STUDIO_PLUGIN;
  const tab = (params: JsonValue | null) => ({ pluginId, tabId: how.tabId, params, title: named });
  switch (entry.ref) {
    case "thread": return ref.id ? tab({ threadId: ref.id }) : null;
    case "run": return ref.id && /^wfr_[0-9a-f-]+$/i.test(ref.id) ? tab({ runId: ref.id }) : null;
    case "entry": return ref.id ? tab({ id: ref.id }) : null;
    case "item": {
      const kind = studioTabKind(ref.kind);
      return ref.id && kind && itemKindOfId(ref.id) === ref.kind ? tab({ kind, id: ref.id }) : null;
    }
    case "bot":
      if (ref.kind === "bot") return ref.id ? tab({ botId: ref.id }) : null;
      return tab(ref.id && (ref.kind === "memory" || ref.kind === "skills" || ref.kind === "archive") ? { botId: ref.id } : null);
    default: return tab(null);
  }
}

const stringField = (params: JsonValue | null | undefined, key: string): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const value = params[key];
  return typeof value === "string" && value ? value : null;
};

/** What one of Studio's (or Visual Chat's) workbench tabs shows; null for other tabs and the pickers (no params). A thread tab is a conversation. */
export function refOfTab(tab: { pluginId: string; tabId: string; params: JsonValue | null | undefined }): TabRef | null {
  if (tab.pluginId === VISUAL_CHAT_PLUGIN) {
    const threadId = tab.tabId === TAB_IDS.board ? stringField(tab.params, "threadId") : null;
    return threadId ? { kind: "board", id: threadId } : null;
  }
  if (tab.pluginId === WORKFLOWS_PLUGIN) {
    const runId = tab.tabId === WORKFLOW_RUN_TAB ? stringField(tab.params, "runId") : null;
    return runId ? { kind: "workflow", id: runId } : null;
  }
  if (tab.pluginId !== STUDIO_PLUGIN) return null;
  if (tab.tabId === TAB_IDS.thread) { const id = stringField(tab.params, "threadId"); return id ? { kind: "conversation", id } : null; }
  if (tab.tabId === TAB_IDS.bot) { const id = stringField(tab.params, "botId"); return id ? { kind: "bot", id } : null; }
  if (tab.tabId === STUDIO_TAB) {
    const id = stringField(tab.params, "id");
    const kind = id ? itemKindOfId(id) : null;
    return kind ? { kind, id } : null;
  }
  const row = TAB_KIND_REGISTRY.find((entry) => entry.ref === "entry" && entry.open.via === "studio" && entry.open.tabId === tab.tabId);
  if (row) { const id = stringField(tab.params, "id"); return id ? { kind: row.id, id } : null; }
  const page = TAB_KIND_REGISTRY.find((entry) => { const open = entry.open; return entry.ref !== "item" && entry.ref !== "thread" && open.via === "studio" && open.tabId === tab.tabId; });
  return page ? { kind: page.id, id: stringField(tab.params, "botId") } : null;
}

const enc = encodeURIComponent;
const itemSegment = (kind: TabKindId) => {
  const tabKind = studioTabKind(kind);
  const info = TAB_KINDS.find((each) => each.kind === tabKind);
  return info ? BUILTIN_ROUTES.find((route) => route.pluginId === info.pluginId && route.kind === info.kind)?.segment ?? null : null;
};

/** The main view's address of `ref`; null for bb's own kinds and a ref missing its id. */
export function pathFor(ref: TabRef): string | null {
  const id = ref.id;
  switch (ref.kind) {
    case "conversation": case "worker": return id ? `/threads/${enc(id)}` : null;
    case "bot": return id ? `${STUDIO_ROOT}/bot/${enc(id)}` : null;
    case "board": return id ? `/plugins/${VISUAL_CHAT_PLUGIN}/canvas/${enc(id)}` : null;
    case "memory": return `${STUDIO_ROOT}/memory${id ? `/${enc(id)}` : ""}`;
    case "skills": return `${STUDIO_ROOT}/skills${id ? `/${enc(id)}` : ""}`;
    case "library": return STUDIO_ROOT;
    case "automations": return "/plugins/studio/automations";
    case "todos": return id ? `${STUDIO_ROOT}/bot/${enc(id)}/loops` : null;
    case "archive": return `${STUDIO_ROOT}/conversations${id ? `/${enc(id)}` : ""}`;
    case "vscode": return "/plugins/studio/vscode";
    case "automation": case "todo": case "record": return id ? `${STUDIO_ROOT}/${ref.kind}/${enc(id)}` : null;
    case "file": case "diff": case "browser": case "terminal": case "workflow": return null;
    default: {
      const segment = itemSegment(ref.kind);
      return segment && id && itemKindOfId(id) === ref.kind ? `${STUDIO_ROOT}/${segment}/${enc(id)}` : null;
    }
  }
}

const decode = (segment: string): string | null => { try { return decodeURIComponent(segment); } catch { return null; } };
const THREAD_PATH = /^\/(?:projects\/[^/?#]+\/)?threads\/([^/?#]+)(?:\/|$)/;

/**
 * What an address in the main view shows, in registry terms: a thread (a
 * conversation), a Studio item under any of its own addresses, a Bot, a
 * Bot page, a board or VS Code. Null for every other address.
 */
export function refOfPath(pathname: string): TabRef | null {
  const path = (pathname.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  const thread = THREAD_PATH.exec(path);
  if (thread) { const id = decode(thread[1]!); return id ? { kind: "conversation", id } : null; }
  const board = new RegExp(`^/plugins/${VISUAL_CHAT_PLUGIN}/canvas/([^/]+)$`).exec(path);
  if (board) { const id = decode(board[1]!); return id && id !== "new" ? { kind: "board", id } : null; }
  if (path === "/plugins/studio/automations") return { kind: "automations", id: null };
  if (path === "/plugins/studio/vscode" || path.startsWith("/plugins/studio/vscode/")) return { kind: "vscode", id: null };
  if (path === STUDIO_ROOT) return { kind: "library", id: null };
  if (!path.startsWith(`${STUDIO_ROOT}/`)) return null;
  const [first = "", second, third, ...rest] = path.slice(STUDIO_ROOT.length + 1).split("/");
  const id = second ? decode(second) : null;
  if (first === "memory") return rest.length || third ? null : { kind: "memory", id };
  if (first === "skills") return rest.length || third ? null : { kind: "skills", id };
  if (first === "conversations") return rest.length || third ? null : { kind: "archive", id };
  if (first === "automation" || first === "todo" || first === "record") return id && !third && !rest.length ? { kind: first, id } : null;
  if (first === "bot") {
    if (!id || id === "new") return null;
    if (third === "loops" && !rest.length) return { kind: "todos", id };
    return third ? null : { kind: "bot", id };
  }
  const kind = id ? itemKindOfId(id) : null;
  const segments = new Set([...ITEM_KINDS.map((each) => itemSegment(each.id)), "pages", "apps"]);
  return kind && id && segments.has(first) ? { kind, id } : null;
}

/** "New <kind>" for what makes one, and "Open <kind>" for a picker whose kind also has a New action; a page of its own (Memory, VS Code…) keeps its name, which is also its tab's title. */
function pickerOrNew(group: NewTabGroup, kind: TabKindId): boolean {
  return group === "New" || TAB_KIND_REGISTRY.some((entry) => entry.id === kind && entry.actions.some((action) => action.group === "New"));
}

/**
 * The New Tab page's Actions Studio registers, in the order they are listed:
 * the "New" heading (each makes one), then "Open" (a page of the Bot's, VS
 * Code, or a picker). What makes one is titled "New <kind>", a picker
 * "Open <kind>" (bb's action search lists every match under one heading), and
 * a page of its own keeps its name, which is also its tab's title.
 */
export const NEW_TAB_ACTIONS: readonly { kind: TabKindId; tabId: string; title: string; group: NewTabGroup; tooltip: string; create: boolean }[] = (() => {
  const actions = TAB_KIND_REGISTRY.flatMap((entry) => entry.actions.map((action) => ({
    kind: entry.id, tabId: action.tabId, group: action.group, create: action.group === "New",
    title: pickerOrNew(action.group, entry.id) ? `${action.group} ${entry.name.toLowerCase()}` : entry.name,
    tooltip: `${action.group === "New" ? "New" : "Open"} ${entry.name === "VS Code" ? entry.name : entry.name.toLowerCase()}`,
  })));
  return NEW_TAB_GROUPS.flatMap((group) => actions.filter((action) => action.group === group));
})();

/** The New Tab title of a Studio action tab, from the registry; null for a tab the registry doesn't list there. */
export function newTabTitle(tabId: string): string | null {
  return NEW_TAB_ACTIONS.find((action) => action.tabId === tabId)?.title ?? null;
}

/** What a Studio action tab's registration adds for the New Tab page: its heading and its tooltip. Empty for a tab the registry doesn't list. */
export function newTabFields(tabId: string): { experimental_newTabGroup?: NewTabGroup; tooltip?: string } {
  const action = NEW_TAB_ACTIONS.find((each) => each.tabId === tabId);
  return action ? { experimental_newTabGroup: action.group, tooltip: action.tooltip } : {};
}

/** Kinds whose name or plural a search query names ("whiteboard", "todos"): their rows answer it. */
export function kindsNamedBy(query: string): TabKindId[] {
  const text = query.trim().toLocaleLowerCase();
  if (text.length < 3) return [];
  return TAB_KIND_REGISTRY.filter((entry) => [entry.name, entry.plural].some((name) => name.toLocaleLowerCase().startsWith(text) || text.startsWith(name.toLocaleLowerCase()))).map((entry) => entry.id);
}

/** The audit table (docs/tab-kinds-audit.md), from the registry: rows are kinds, columns surfaces, each n/a with its footnote. */
export function auditTable(): string {
  const notes: string[] = [];
  const cell = (status: SurfaceStatus) => {
    if (typeof status === "string") return status;
    let at = notes.indexOf(status.na);
    if (at < 0) { notes.push(status.na); at = notes.length - 1; }
    return `n/a [${at + 1}]`;
  };
  const rows = TAB_KIND_REGISTRY.map((entry) => `| ${entry.name}${entry.owner === "bb" ? " (bb)" : ""} | ${SURFACES.map((surface) => cell(entry.surfaces[surface])).join(" | ")} |`);
  return [
    `| Kind | ${SURFACES.map((surface) => SURFACE_NAMES[surface]).join(" | ")} |`,
    `| --- | ${SURFACES.map(() => "---").join(" | ")} |`,
    ...rows,
    "",
    ...notes.map((note, index) => `[${index + 1}] ${note}`),
  ].join("\n");
}
