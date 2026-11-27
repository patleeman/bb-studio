// The workbench tools on the server: workbench_list, workbench_open,
// workbench_tab (close, focus, pop_out) and workbench_arrange act on the calling
// conversation's workbench. Its tabs are the conversation's Workspace, kept
// here (store.ts): list, open, close and focus read and write it with no
// window needed, and every window showing the conversation follows
// (ui/sync.ts). What only a desktop window can do (pop_out, arrange, an open
// into a pane or a window of its own) is published on WORKBENCH_CHANNEL; the
// window showing that conversation claims it, runs it (exec.ts) and replies
// (contract.ts). No claim within CLAIM_MS means the conversation isn't on
// screen.
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { linksContract } from "../links/contract";
import { parseLink } from "../links/router";
import { linkHandlers } from "../links/server";
import type Database from "better-sqlite3";
import { AGENT_TYPES, itemKindOfId, kindOfAgentType, STUDIO_PLUGIN, tabKindEntry, tabOpenFor, TAB_KIND_REGISTRY, type TabKindEntry } from "../tab-kinds";
import { workbenchContract, workspaceRpcContract } from "./contract";
import { WorkspaceStore } from "./store";
import { refOfSpec, type WorkspaceTabRef } from "./workspace";
import { WORKSPACE_CHANGED_CHANNEL } from "./workspace-contract";
import { stateView, WorkspaceService } from "./workspace-server";
import { PANE_LIMITS, WINDOW_KINDS } from "./exec";
import {
  CLAIM_MS, itemOfSpec, MAX_WIDTH_PERCENT, MIN_PANE_PERCENT, MIN_WIDTH_PERCENT, RESULT_MS, WORKBENCH_CHANNEL,
  type OpenSpec, type WorkbenchCommand, type WorkbenchLayout, type WorkbenchOp, type WorkbenchRecord,
} from "./shared";

export const WORKBENCH_TOOLS = ["workbench_list", "workbench_open", "workbench_tab", "workbench_arrange"] as const;

export type CallOutcome = { status: "off-screen" } | { status: "timeout" } | { status: "done"; message: string; record: WorkbenchRecord };

interface Pending { claimed: boolean; timer: ReturnType<typeof setTimeout>; finish(outcome: CallOutcome): void }

/** Sends one call to the app window showing a conversation and waits for its answer. */
export class WorkbenchRouter {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly publish: (command: WorkbenchCommand) => void,
    private readonly timing: { claimMs: number; resultMs: number } = { claimMs: CLAIM_MS, resultMs: RESULT_MS },
    private readonly newId: () => string = randomUUID,
  ) {}

  call(threadId: string, op: WorkbenchOp, record: WorkbenchRecord): Promise<CallOutcome> {
    const requestId = this.newId();
    return new Promise((resolve) => {
      const finish = (outcome: CallOutcome) => {
        const entry = this.pending.get(requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        resolve(outcome);
      };
      this.pending.set(requestId, { claimed: false, timer: setTimeout(() => finish({ status: "off-screen" }), this.timing.claimMs), finish });
      try {
        this.publish({ requestId, threadId, op, record });
      } catch {
        finish({ status: "off-screen" });
      }
    });
  }

  /** The first window to claim a waiting call runs it; every later claim is told no. */
  claim(requestId: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry || entry.claimed) return false;
    entry.claimed = true;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => entry.finish({ status: "timeout" }), this.timing.resultMs);
    return true;
  }

  reply(requestId: string, message: string, record: WorkbenchRecord): boolean {
    const entry = this.pending.get(requestId);
    if (!entry?.claimed) return false;
    entry.finish({ status: "done", message, record });
    return true;
  }

  dispose(): void {
    for (const entry of [...this.pending.values()]) entry.finish({ status: "off-screen" });
  }
}

export const OFF_SCREEN = "This conversation isn't on screen in BB, so its workbench can't be reached. Nothing changed.";
export const NO_ANSWER = "BB's window didn't answer in time. Call workbench (op: list) to see what changed.";
export const STACKED = `Stacked isn't available. ${PANE_LIMITS} Nothing changed.`;

type FileTarget = Extract<OpenSpec, { kind: "file" }>["target"];

/** What the tools look up to turn the agent's input into an op. */
export interface WorkbenchLookups {
  /** A thread's title, or null when there is no such thread. */
  threadTitle(threadId: string): Promise<string | null>;
  /** A Studio item's title, or null when there is no such item. */
  itemTitle(id: string): string | null;
  /** A Bot's name, or null when there is no such Bot. */
  botName(id: string): string | null;
  /** An automation's or a todo's title, or null when there is none with that id. */
  entryTitle(kind: "automation" | "todo", id: string): Promise<string | null>;
  /** Where a path (full, or relative to the conversation's working folder) is, for BB's file preview; null when BB can't show it. */
  fileTarget(threadId: string, path: string): Promise<FileTarget | null>;
  /** A path as the conversation's workspace names it, for the diff tab. */
  workspacePath(threadId: string, path: string): Promise<string>;
}

export interface WorkbenchToolDeps extends WorkbenchLookups {
  router: Pick<WorkbenchRouter, "call">;
  workspace: WorkspaceService;
}

const force = z.boolean().optional().describe("Override user choice when explicitly asked");
const tabKey = z.string().trim().min(1).max(500).describe("Tab key from workbench (op: list)");

const studioKinds = TAB_KIND_REGISTRY.filter((entry) => entry.agentType && entry.owner !== "bb");
const typesBy = (ref: TabKindEntry["ref"]) => studioKinds.filter((entry) => entry.ref === ref).map((entry) => entry.agentType).join(", ");
const pane = z.union([z.literal(1), z.literal(2), z.literal("new"), z.literal("window")]).optional()
  .describe('Pane 1 (left), 2 (right), "new", or "window"');

/** workbench_open's input: `type` is every kind of the tab kinds registry (src/tab-kinds.ts) the agent may open. */
const openInput = z.object({
  type: z.enum(AGENT_TYPES as [string, ...string[]]).optional().describe("Kind to open (or use link)"),
  link: z.string().trim().min(1).max(4096).optional()
    .describe("Link instead of type+id (bb://…, /plugins/…, /threads/…, ::page{…}, file://, https://)"),
  id: z.string().trim().min(1).max(200).optional()
    .describe(`Target id for ${typesBy("thread")}, ${typesBy("item")}, bot, workflow, or entry`),
  path: z.string().trim().min(1).max(4096).optional().describe("File/diff path"),
  line: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  url: z.string().trim().url().max(4096).optional(),
  pane,
  index: z.number().int().min(0).max(500).optional(),
  focus: z.boolean().optional().describe("Default true; false opens behind active tab"),
  force,
});

const arrangeInput = z.object({
  layout: z.enum(["side by side", "panel only", "conversation only", "stacked"]).optional()
    .describe("side by side | panel only | conversation only (stacked unavailable)"),
  widthPercent: z.number().min(MIN_WIDTH_PERCENT).max(MAX_WIDTH_PERCENT).optional().describe(`Workbench width % (${MIN_WIDTH_PERCENT}–${MAX_WIDTH_PERCENT})`),
  panes: z.union([z.literal(1), z.literal(2)]).optional(),
  paneWidths: z.tuple([z.number().positive(), z.number().positive()]).optional()
    .describe(`Two-pane ratio, e.g. [2, 1] (min ${MIN_PANE_PERCENT}% each)`),
  force,
});

const LAYOUTS: Record<"side by side" | "panel only" | "conversation only", Partial<WorkbenchLayout>> = {
  "side by side": { panel: "open", conversation: "shown" },
  "panel only": { panel: "open", conversation: "collapsed" },
  "conversation only": { panel: "closed", conversation: "shown" },
};

type OpenInput = z.infer<typeof openInput>;

/** The type, id, path or url a link names, in the tool's own terms; a string says why it can't be opened. */
export function linkedInput(link: string): Pick<OpenInput, "type" | "id" | "path" | "url"> | string {
  const target = parseLink(link, "");
  if (!target) return `${JSON.stringify(link)} isn't a link to anything BB can open: use bb://<kind>/<id>, a BB address, a card directive, a file:// URL or an http(s) URL.`;
  if (target.type === "external") return { type: "url", url: target.url };
  if (target.type === "action") return `${link} opens ${target.action === "accounts" ? "Accounts" : "Edit space"} for the user; it isn't a workbench tab.`;
  const entry = TAB_KIND_REGISTRY.find((each) => each.id === target.ref.kind)!;
  if (!entry.agentType) return `${entry.plural} can't be opened by link.`;
  if (entry.ref === "path") return { type: entry.agentType, path: target.ref.id ?? undefined };
  if (entry.ref === "url") return { type: entry.agentType, url: target.ref.id ?? undefined };
  return { type: entry.agentType, id: target.ref.id ?? undefined };
}

/** The op for a workbench_open call, or the reason it can't be made. */
export async function openOp(given: OpenInput, threadId: string, deps: WorkbenchLookups): Promise<WorkbenchOp | string> {
  const linked = given.link ? linkedInput(given.link) : null;
  if (typeof linked === "string") return linked;
  const input: OpenInput = linked ? { ...given, ...linked } : given;
  if (!input.type) return "Give a type, or a link.";
  const flags = { focus: input.focus !== false, force: input.force === true, ...(input.pane !== undefined ? { pane: input.pane } : {}), ...(input.index !== undefined ? { index: input.index } : {}) };
  const make = (spec: OpenSpec, title: string): WorkbenchOp => ({ type: "open", spec, item: itemOfSpec(spec), title, ...flags });
  const kind = kindOfAgentType(input.type);
  if (!kind) return `Unknown type ${input.type}.`;
  if (input.pane === "window" && (kind.id === "diff" || kind.id === "browser")) return `${kind.plural} can't open in windows of their own. ${WINDOW_KINDS}`;
  const tab = (id: string | null, title: string): WorkbenchOp | string => {
    const open = tabOpenFor({ kind: kind.id, id }, title);
    if (!open) return `BB can't open that ${kind.name.toLowerCase()} as a tab.`;
    const owner = open.pluginId === STUDIO_PLUGIN ? {} : { pluginId: open.pluginId };
    return make({ kind: "tab", tab: { id: open.tabId, ...owner }, ...(open.params !== null ? { params: open.params } : {}), title: open.title }, open.title);
  };
  switch (kind.ref) {
    case "thread": {
      if (!input.id) return `Give the ${kind.name.toLowerCase()}'s thread id.`;
      if (input.id === threadId) return "That's this conversation; it can't open beside itself.";
      const title = await deps.threadTitle(input.id);
      if (title === null) return `No thread has id ${input.id}.`;
      return tab(input.id, title);
    }
    case "item": {
      if (!input.id) return `Give the ${kind.name.toLowerCase()}'s id.`;
      const title = itemKindOfId(input.id) === kind.id ? deps.itemTitle(input.id) : null;
      if (title === null) return `No ${kind.name.toLowerCase()} has id ${input.id}.`;
      return tab(input.id, title.trim() || "Untitled");
    }
    case "bot": {
      const name = input.id ? deps.botName(input.id) : null;
      if (input.id && name === null) return `No Bot has id ${input.id}.`;
      if (kind.id === "bot" && !input.id) return "Give the Bot's id.";
      return tab(input.id ?? null, kind.id === "bot" ? name! : kind.name);
    }
    case "entry": {
      if (!input.id) return `Give the ${kind.name.toLowerCase()}'s id.`;
      const title = kind.id === "automation" || kind.id === "todo" ? await deps.entryTitle(kind.id, input.id) : null;
      if (title === null) return `No ${kind.name.toLowerCase()} has id ${input.id}.`;
      return tab(input.id, title.trim() || kind.name);
    }
    case "none": return tab(null, kind.name);
    case "run":
      if (!input.id) return "Give the workflow run's id (wfr_…).";
      return tab(input.id, kind.name);
    case "path": {
      if (kind.id === "file") {
        if (!input.path) return "Give the file's path.";
        const target = await deps.fileTarget(threadId, input.path);
        if (!target) return `BB can't show ${input.path}: give a full path, or one inside this conversation's worktree.`;
        const location = input.line ? (input.endLine && input.endLine > input.line ? { kind: "range" as const, startLine: input.line, endLine: input.endLine } : { kind: "line" as const, line: input.line, column: null }) : null;
        return make({ kind: "file", target, location }, input.path);
      }
      if (!input.path) return "Give the changed file's path.";
      const path = await deps.workspacePath(threadId, input.path);
      return make({ kind: "diff", path }, `Diff of ${path}`);
    }
    case "url":
      if (!input.url || !/^https?:\/\//i.test(input.url)) return "Give an http(s) URL.";
      return make({ kind: "url", url: input.url }, input.url);
  }
}

export type ToolName = (typeof WORKBENCH_TOOLS)[number];
type TabInput = { action: "close" | "focus" | "pop_out"; key: string; force?: boolean };
type ArrangeInput = z.infer<typeof arrangeInput>;

/** The op a tool call makes, as the window would run it (exec.ts), or why it can't be made. */
export async function toolOp(name: ToolName, input: object, threadId: string, deps: WorkbenchLookups): Promise<WorkbenchOp | string> {
  switch (name) {
    case "workbench_list": return { type: "list" };
    case "workbench_open": return openOp(input as OpenInput, threadId, deps);
    case "workbench_tab": {
      const tab = input as TabInput;
      return { type: tab.action === "pop_out" ? "popOut" : tab.action, key: tab.key, force: tab.force === true };
    }
    case "workbench_arrange": {
      const given = input as ArrangeInput;
      if (given.layout === "stacked") return STACKED;
      if (!given.layout && given.widthPercent === undefined && given.panes === undefined && !given.paneWidths) return "Give a layout, a widthPercent, panes, paneWidths, or several.";
      const layout: Partial<WorkbenchLayout> = {
        ...(given.layout ? LAYOUTS[given.layout] : {}),
        ...(given.widthPercent !== undefined ? { widthPercent: given.widthPercent } : {}),
        ...(given.panes !== undefined ? { panes: given.panes } : {}),
        ...(given.paneWidths ? { paneWidths: given.paneWidths } : {}),
      };
      return { type: "arrange", layout, force: given.force === true };
    }
  }
}

/** What a stored tab is, by the tab kinds registry's name ("Page", "Memory"), else whose tab it is. */
function kindName(ref: WorkspaceTabRef): string {
  if (ref.kind === "plugin") return ref.pluginId === STUDIO_PLUGIN ? `Studio ${ref.tabId} tab` : `${ref.pluginId} tab`;
  return tabKindEntry(ref.kind).name;
}

const FORCE_NOTE = "Pass force: true only when the user asks for it.";
const unknownTab = (key: string) => `No tab has key ${JSON.stringify(key)}. Call workbench (op: list) for the current keys.`;
const LAYOUT_NAMES: Record<string, string> = { panel: "the panel open or closed", widthPercent: "the panel width", conversation: "the conversation shown or collapsed", panes: "the number of panes", paneWidths: "the pane widths" };

/** workbench_list's answer, from the Workspace the server keeps. */
export function listText(workspace: WorkspaceService, threadId: string): string {
  const state = workspace.get(threadId);
  const lines = [`${state.tabs.length ? `${state.tabs.length} tab${state.tabs.length === 1 ? "" : "s"}` : "No tabs open"}${state.panelOpen === null ? "" : `, panel ${state.panelOpen ? "open" : "closed"}`}.`];
  for (const tab of state.tabs) {
    const notes = [kindName(tab.ref), tab.tabId === state.activeTabId ? "selected" : null, tab.openedBy === "agent" ? "opened by you" : null].filter(Boolean);
    lines.push(`- key ${JSON.stringify(tab.tabId)}: ${JSON.stringify(tab.title)} (${notes.join(", ")})`);
  }
  const closed = workspace.store.closedByUser(threadId).filter((each) => !state.tabs.some((tab) => tab.item === each.item));
  if (closed.length) lines.push(`Closed by the user after you opened them (not reopened without force): ${closed.slice(0, 20).map((each) => JSON.stringify(each.title)).join(", ")}.`);
  const { userLayout } = workspace.store.layout(threadId);
  if (userLayout.length) lines.push(`Changed by the user after you set it (left as is without force): ${userLayout.map((field) => LAYOUT_NAMES[field] ?? field).join(", ")}.`);
  return lines.join("\n");
}

/**
 * The four tools, for bb.agents.registerTool. List, open, close and focus
 * read and write the Workspace on the server, with no window needed; each
 * desktop window showing the conversation follows it (ui/sync.ts). Only what
 * just a desktop window can do goes to one: pop_out, arrange, and an open
 * into a pane or a window of its own.
 */
export function workbenchTools(deps: WorkbenchToolDeps) {
  const { workspace } = deps;
  /** Runs an op in the window showing the conversation, with the layout record the server keeps. */
  const inWindow = async (threadId: string, op: WorkbenchOp): Promise<string | null> => {
    const outcome = await deps.router.call(threadId, op, { opened: [], dismissed: [], ...workspace.store.layout(threadId) });
    if (outcome.status === "off-screen") return null;
    if (outcome.status === "timeout") return NO_ANSWER;
    workspace.store.setLayout(threadId, { layoutSet: outcome.record.layoutSet, userLayout: outcome.record.userLayout });
    return outcome.message;
  };
  const NOT_SHOWN = "No BB window or phone shows this conversation now: it appears when the conversation is shown.";
  /** " (shown on the phone)" when only the phone shows the conversation, so the answer says where. */
  const where = (threadId: string) => (workspace.shownOn(threadId) === "phone" ? " (shown on the phone)" : "");
  const storeOpen = async (threadId: string, op: Extract<WorkbenchOp, { type: "open" }>): Promise<string> => {
    const outcome = await workspace.mutate(threadId, { op: "open", tab: refOfSpec(op.spec), title: op.title, focus: op.focus, force: op.force, ...(op.index !== undefined ? { position: op.index } : {}) }, "agent");
    const name = JSON.stringify(op.title);
    const key = `key ${JSON.stringify(outcome.tabId)}`;
    if (outcome.result === "refused" || outcome.result === "notFound" || outcome.result === "conflict") return outcome.message ?? `${name} didn't open.`;
    if (!workspace.isShown(threadId)) {
      const selected = op.focus ? " as the selected tab" : "";
      return outcome.created ? `Saved ${name} to this conversation's Workspace (${key})${selected}. ${NOT_SHOWN}` : `${name} is already in this conversation's Workspace (${key})${op.focus ? "; it is the selected tab" : ""}. ${NOT_SHOWN}`;
    }
    const on = where(threadId);
    if (!outcome.created) return op.focus ? `${name} was already open (${key}); selected it${on}.` : `${name} was already open (${key}); left it where it is${on}.`;
    return `Opened ${name} (${key}) ${op.focus ? "and selected it" : "behind the selected tab"}${on}.`;
  };
  const run = async (name: ToolName, input: object, threadId: string): Promise<string> => {
    const op = await toolOp(name, input, threadId, deps);
    if (typeof op === "string") return op;
    switch (op.type) {
      case "list": return listText(workspace, threadId);
      case "open": {
        if (op.pane === undefined || op.pane === 1) return storeOpen(threadId, op);
        // A pane or a window of its own is the desktop's: the window places it. Into a pane, the Workspace has it first, so the window's sync doesn't count it as the user's.
        if (op.pane !== "window") {
          const stored = await storeOpen(threadId, op);
          if (!stored.startsWith("Opened") && !stored.includes("was already open")) return stored;
          return (await inWindow(threadId, op)) ?? `${stored} It wasn't placed in pane ${op.pane === "new" ? 2 : op.pane}: no BB window shows this conversation now.`;
        }
        return (await inWindow(threadId, op)) ?? `${await storeOpen(threadId, { ...op, pane: undefined })} No window of its own: that needs the conversation on screen in BB.`;
      }
      case "close": case "focus": {
        const tab = workspace.get(threadId).tabs.find((each) => each.tabId === op.key);
        if (!tab) return unknownTab(op.key);
        const outcome = await workspace.mutate(threadId, { op: op.type, tabId: op.key }, "agent");
        if (outcome.result === "notFound") return unknownTab(op.key);
        if (outcome.result !== "ok" && outcome.result !== "unchanged") return outcome.message ?? `${JSON.stringify(tab.title)} didn't change.`;
        const title = JSON.stringify(tab.title);
        if (!workspace.isShown(threadId)) return op.type === "close" ? `Closed ${title} in this conversation's Workspace. No BB window or phone shows this conversation now.` : `${title} is the selected tab in this conversation's Workspace. ${NOT_SHOWN}`;
        return op.type === "close" ? `Closed ${title}${where(threadId)}.` : `Selected ${title}${where(threadId)}.`;
      }
      case "popOut": {
        const tab = workspace.get(threadId).tabs.find((each) => each.tabId === op.key);
        if (!tab) return unknownTab(op.key);
        return (await inWindow(threadId, { ...op, item: tab.item })) ?? OFF_SCREEN;
      }
      case "arrange": return (await inWindow(threadId, op)) ?? OFF_SCREEN;
    }
  };
  const tool = <I extends object>(name: ToolName, description: string, parameters: z.ZodType<I>) => ({
    name, description, parameters,
    execute: (input: I, ctx: { threadId: string }) => run(name, input, ctx.threadId),
  });
  return [
    tool("workbench_list", "List the tabs of this conversation's workbench (its Workspace), with their keys.", z.object({})),
    tool("workbench_open", "Open a tab in this conversation's workbench (or pane \"window\" for its own window) by type+id/path/url or link. Selects if already open. Won't reopen what the user closed after you opened it.", openInput),
    tool("workbench_tab", `Act on a workbench tab by key (from workbench (op: list)): action "close", "focus", or "pop_out" (into its own window; needs the conversation on screen in BB). ${FORCE_NOTE.replace("Pass", "pop_out takes force:")}`, z.object({ action: z.enum(["close", "focus", "pop_out"]), key: tabKey, force })),
    tool("workbench_arrange", `Arrange the workbench on screen in BB: layout (side by side, panel only, conversation only), widthPercent (${MIN_WIDTH_PERCENT}–${MAX_WIDTH_PERCENT}), panes (1|2), paneWidths. A setting the user changed after you set it stays theirs.`, arrangeInput),
  ];
}

/** Where a conversation works: its worktree (environment) and the folder it is in, when it has one. */
export interface ThreadPlace { environmentId: string | null; hostId: string | null; root: string | null }

const inside = (root: string, file: string) => { const rel = relative(root, file); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); };

/** BB's file target for `path` from a conversation: in its worktree when it is there, else on its machine by full path. */
export function fileTargetIn(place: ThreadPlace, primaryHostId: string | null, path: string): FileTarget | null {
  const file = isAbsolute(path) ? resolve(path) : place.root ? resolve(place.root, path) : null;
  if (!file) return null;
  if (place.environmentId && place.root && inside(place.root, file)) return { kind: "workspace", environmentId: place.environmentId, path: relative(place.root, file) || "." };
  const hostId = place.hostId ?? primaryHostId;
  return hostId ? { kind: "host", hostId, path: file } : null;
}

/** The file's full path when it is on the machine BB runs on, else null (another machine's files aren't checked). */
export function localFileIn(place: ThreadPlace, primaryHostId: string | null, path: string): string | null {
  const file = isAbsolute(path) ? resolve(path) : place.root ? resolve(place.root, path) : null;
  if (!file || !primaryHostId) return null;
  return (place.hostId ?? primaryHostId) === primaryHostId ? file : null;
}

/** A path as the worktree names it (relative to its folder), for the diff tab. */
export function workspacePathIn(place: ThreadPlace, path: string): string {
  if (isAbsolute(path) && place.root && inside(place.root, resolve(path))) return relative(place.root, resolve(path));
  return normalize(path).replace(/^\.\/+/u, "");
}

/** Registers the tools, the Workspace RPCs and the window's RPCs; answers the Workspace for the rest of Studio. */
export function registerWorkbenchAgent(bb: BbPluginApi, db: Database.Database, deps: { itemTitle(id: string): string | null; botName(id: string): string | null; entryTitle(kind: "automation" | "todo", id: string): Promise<string | null> }): WorkspaceService {
  const router = new WorkbenchRouter((command) => { void bb.realtime.publish(WORKBENCH_CHANNEL, command as never); });
  bb.onDispose(() => router.dispose());
  const place = async (threadId: string): Promise<ThreadPlace> => {
    const thread = (await bb.sdk.threads.get({ threadId }).catch(() => null)) as { environmentId?: string | null } | null;
    const environmentId = thread?.environmentId ?? null;
    if (!environmentId) return { environmentId: null, hostId: null, root: null };
    const environment = (await bb.sdk.environments.get({ environmentId }).catch(() => null)) as { hostId?: string; path?: string | null } | null;
    return { environmentId, hostId: environment?.hostId ?? null, root: environment?.path ?? null };
  };
  const primaryHostId = async () => ((await bb.sdk.system.config().catch(() => null)) as { primaryHostId?: string } | null)?.primaryHostId ?? null;
  // A desktop window reports a file by path alone: the server adds where it is, so the phone can show it.
  const completeRef = async (threadId: string, ref: WorkspaceTabRef): Promise<WorkspaceTabRef> => {
    if (ref.kind !== "file" || !ref.path || ref.environmentId || ref.hostId) return ref;
    const target = fileTargetIn(await place(threadId), await primaryHostId(), ref.path);
    if (!target) return ref;
    return target.kind === "workspace" ? { kind: "file", path: target.path, environmentId: target.environmentId } : { kind: "file", path: target.path, hostId: target.hostId };
  };
  const exists = <T>(lookup: () => Promise<T>) => lookup().then((found) => !!found, () => false);
  const workspace = new WorkspaceService(new WorkspaceStore(db), (event) => { void bb.realtime.publish(WORKSPACE_CHANGED_CHANNEL, event as never); }, completeRef, {
    threadExists: (threadId) => exists(() => bb.sdk.threads.get({ threadId })),
    placeProblem: async (ref) => {
      if (ref.kind !== "file") return null;
      if (ref.environmentId && !(await exists(() => bb.sdk.environments.get({ environmentId: ref.environmentId! })))) return `No worktree has id ${JSON.stringify(ref.environmentId)}.`;
      if (ref.hostId && !(await exists(() => bb.sdk.hosts.get({ hostId: ref.hostId! })))) return `No machine has id ${JSON.stringify(ref.hostId)}.`;
      return null;
    },
  });
  // A deleted conversation's Workspace goes with it.
  bb.events.on("thread.deleted", ({ thread }) => { try { workspace.forget(thread.id); } catch { /* nothing stored */ } });
  bb.rpc.register(workbenchContract, {
    "workbench.claim": ({ requestId }) => ({ go: router.claim(requestId) }),
    "workbench.reply": ({ requestId, message, record }) => ({ ok: router.reply(requestId, message, record) }),
    "workbench.import": async ({ threadId, tabs, activeIndex, panelOpen, origin }) => {
      const result = await workspace.importOnce(threadId, tabs as { ref: WorkspaceTabRef; title: string }[], activeIndex, panelOpen, origin ?? null);
      return { imported: result.imported, state: stateView(result.state) };
    },
  });
  bb.rpc.register(workspaceRpcContract, {
    threadWorkbenchGet: ({ threadId }) => stateView(workspace.get(threadId)),
    threadWorkbenchMutate: (input) => workspace.rpcMutate(input),
    threadWorkbenchShown: ({ threadIds, origin }) => { workspace.markShown(threadIds, origin); return { ok: true }; },
  });
  const lookups = {
    itemTitle: deps.itemTitle,
    botName: deps.botName,
    entryTitle: deps.entryTitle,
    threadTitle: async (threadId: string) => {
      const thread = (await bb.sdk.threads.get({ threadId }).catch(() => null)) as { title?: string | null; titleFallback?: string | null } | null;
      return thread ? thread.title?.trim() || thread.titleFallback?.trim() || "Untitled thread" : null;
    },
    fileTarget: async (threadId: string, path: string) => fileTargetIn(await place(threadId), await primaryHostId(), path),
    workspacePath: async (threadId: string, path: string) => workspacePathIn(await place(threadId), path),
    fileExists: async (threadId: string, path: string) => {
      const file = localFileIn(await place(threadId), await primaryHostId(), path);
      return file === null ? true : access(file).then(() => true, () => false);
    },
  };
  bb.rpc.register(linksContract, linkHandlers(lookups));
  const tools = workbenchTools({ router, workspace, ...lookups });
  for (const tool of tools) bb.agents.registerTool(tool as never);
  return workspace;
}
