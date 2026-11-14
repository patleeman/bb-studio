// The workbench tools on the server: workbench_list, workbench_open,
// workbench_close, workbench_focus and workbench_arrange act on the calling
// conversation's workbench. The workbench lives in the app, so each call is
// published on WORKBENCH_CHANNEL; the window showing that conversation claims
// it, runs it (exec.ts) and replies (contract.ts). No claim within CLAIM_MS
// means the conversation isn't on screen. Studio keeps each conversation's
// record (what the agent opened, what the user closed or changed) here, in
// memory, and hands it to the window with each call.
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { linksContract } from "../links/contract";
import { parseLink } from "../links/router";
import { linkHandlers } from "../links/server";
import { AGENT_TYPES, itemKindOfId, kindOfAgentType, STUDIO_PLUGIN, tabOpenFor, TAB_KIND_REGISTRY, type TabKindEntry } from "../tab-kinds";
import { workbenchContract } from "./contract";
import { PANE_LIMITS, WINDOW_KINDS } from "./exec";
import {
  CLAIM_MS, EMPTY_RECORD, itemOfSpec, MAX_WIDTH_PERCENT, MIN_PANE_PERCENT, MIN_WIDTH_PERCENT, RESULT_MS, WORKBENCH_CHANNEL,
  type OpenSpec, type WorkbenchCommand, type WorkbenchLayout, type WorkbenchOp, type WorkbenchRecord,
} from "./shared";

export const WORKBENCH_TOOLS = ["workbench_list", "workbench_open", "workbench_close", "workbench_focus", "workbench_pop_out", "workbench_arrange"] as const;

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

/** Each conversation's record, newest used last; the oldest are dropped past `cap`. */
export class WorkbenchRecords {
  private readonly records = new Map<string, WorkbenchRecord>();
  constructor(private readonly cap = 500) {}
  get(threadId: string): WorkbenchRecord {
    return this.records.get(threadId) ?? EMPTY_RECORD;
  }
  set(threadId: string, record: WorkbenchRecord): void {
    this.records.delete(threadId);
    this.records.set(threadId, record);
    while (this.records.size > this.cap) this.records.delete(this.records.keys().next().value!);
  }
}

export const OFF_SCREEN = "This conversation isn't on screen in BB, so its workbench can't be reached. Nothing changed.";
export const NO_ANSWER = "BB's window didn't answer in time. Call workbench_list to see what changed.";
export const STACKED = `Stacked isn't available. ${PANE_LIMITS} Nothing changed.`;

type FileTarget = Extract<OpenSpec, { kind: "file" }>["target"];

export interface WorkbenchToolDeps {
  router: Pick<WorkbenchRouter, "call">;
  records: Pick<WorkbenchRecords, "get" | "set">;
  /** A thread's title, or null when there is no such thread. */
  threadTitle(threadId: string): Promise<string | null>;
  /** A Studio item's title, or null when there is no such item. */
  itemTitle(id: string): string | null;
  /** A Bot's name, or null when there is no such Bot. */
  botName(id: string): string | null;
  /** An automation's, a todo's or a memory record's title, or null when there is none with that id. */
  entryTitle(kind: "automation" | "todo" | "record", id: string): Promise<string | null>;
  /** Where a path (full, or relative to the conversation's working folder) is, for BB's file preview; null when BB can't show it. */
  fileTarget(threadId: string, path: string): Promise<FileTarget | null>;
  /** A path as the conversation's workspace names it, for the diff tab. */
  workspacePath(threadId: string, path: string): Promise<string>;
}

const force = z.boolean().optional().describe("Override the user's choice: reopen what they closed, or change what they set. Only when the user asked.");
const tabKey = z.string().trim().min(1).max(500).describe("The tab's key, from workbench_list");

const studioKinds = TAB_KIND_REGISTRY.filter((entry) => entry.agentType && entry.owner !== "bb");
const typesBy = (ref: TabKindEntry["ref"]) => studioKinds.filter((entry) => entry.ref === ref).map((entry) => entry.agentType).join(", ");
const pane = z.union([z.literal(1), z.literal(2), z.literal("new"), z.literal("window")]).optional()
  .describe(`Which workbench pane: 1 (left), 2 (right), or "new" for a second pane; or "window" for a window of its own, out of the workbench. Default: the pane in use. ${PANE_LIMITS} ${WINDOW_KINDS}`);

/** workbench_open's input: `type` is every kind of the tab kinds registry (src/tab-kinds.ts) the agent may open. */
const openInput = z.object({
  type: z.enum(AGENT_TYPES as [string, ...string[]]).optional().describe("What to open; or give link instead"),
  link: z.string().trim().min(1).max(4096).optional()
    .describe("A link instead of type and id: bb://<kind>/<id> (bb://page/pg_…, bb://conversation/thr_…), a BB address (/plugins/studio/studio/pages/pg_…, /threads/thr_…), a card directive (::page{id=\"pg_…\"}), a file:// URL, or an http(s) URL"),
  id: z.string().trim().min(1).max(200).optional()
    .describe(`${typesBy("thread")}: the thread id; ${typesBy("item")}: its id; bot: the Bot's id; ${studioKinds.filter((entry) => entry.ref === "bot" && entry.id !== "bot").map((entry) => entry.agentType).join(", ")}: the Bot's id, or leave out for the Bot on screen; workflow: the run's id (wfr_…)`),
  path: z.string().trim().min(1).max(4096).optional().describe("file, diff: full, or relative to your working folder"),
  line: z.number().int().min(1).optional().describe("file: the line to show"),
  endLine: z.number().int().min(1).optional().describe("file: the last line of a range"),
  url: z.string().trim().url().max(4096).optional().describe("url: an http(s) address"),
  pane,
  index: z.number().int().min(0).max(500).optional().describe("Its place in the pane's tab strip, from 0. Default: after the others."),
  focus: z.boolean().optional().describe("false opens it behind the selected tab. Default true; while the user is typing in the panel it always opens behind, marked new."),
  force,
});

const arrangeInput = z.object({
  layout: z.enum(["side by side", "panel only", "conversation only", "stacked"]).optional()
    .describe(`side by side: the workbench open beside the conversation; panel only: the conversation collapsed; conversation only: the workbench closed. Stacked isn't available: ${PANE_LIMITS}`),
  widthPercent: z.number().min(MIN_WIDTH_PERCENT).max(MAX_WIDTH_PERCENT).optional().describe(`The workbench's share of the view's width, ${MIN_WIDTH_PERCENT} to ${MAX_WIDTH_PERCENT}`),
  panes: z.union([z.literal(1), z.literal(2)]).optional().describe("1: one pane (the second's tabs join the first); 2: two panes side by side"),
  paneWidths: z.tuple([z.number().positive(), z.number().positive()]).optional()
    .describe(`With two panes: their widths as a ratio, left first, such as [2, 1] or [60, 40]; each pane keeps at least ${MIN_PANE_PERCENT}% of the workbench`),
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
export async function openOp(given: OpenInput, threadId: string, deps: WorkbenchToolDeps): Promise<WorkbenchOp | string> {
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
      return tab(kind.id === "todos" ? null : input.id ?? null, kind.id === "bot" ? name! : kind.name);
    }
    case "entry": {
      if (!input.id) return `Give the ${kind.name.toLowerCase()}'s id.`;
      const title = kind.id === "automation" || kind.id === "todo" || kind.id === "record" ? await deps.entryTitle(kind.id, input.id) : null;
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

/** The five tools, for bb.agents.registerTool. */
export function workbenchTools(deps: WorkbenchToolDeps) {
  const run = async (threadId: string, op: WorkbenchOp): Promise<string> => {
    const outcome = await deps.router.call(threadId, op, deps.records.get(threadId));
    if (outcome.status === "off-screen") return OFF_SCREEN;
    if (outcome.status === "timeout") return NO_ANSWER;
    deps.records.set(threadId, outcome.record);
    return outcome.message;
  };
  return [
    {
      name: "workbench_list",
      description: "List the tabs open in this conversation's workbench (the panel beside the chat), with their keys, which is selected, which you opened, and the panel's layout. Only while the conversation is on screen in BB.",
      parameters: z.object({}),
      execute: async (_input: Record<string, never>, ctx: { threadId: string }) => run(ctx.threadId, { type: "list" }),
    },
    {
      name: "workbench_open",
      description: `Open something as a tab in this conversation's workbench, beside the chat: ${TAB_KIND_REGISTRY.filter((entry) => entry.agentType).map((entry) => entry.agentType === "url" ? "a URL (desktop app only)" : `a ${entry.name.toLowerCase()}`).join(", ")}. Name it with type and id, or with link (a bb://<kind>/<id> link, a BB address, a card directive, a file:// or http(s) URL). pane and index place it, and pane "window" opens it in a window of its own; ${PANE_LIMITS} Already open: selects it. It won't reopen what the user closed after you opened it, and won't take the screen while they type.`,
      parameters: openInput,
      execute: async (input: OpenInput, ctx: { threadId: string }) => {
        const op = await openOp(input, ctx.threadId, deps);
        return typeof op === "string" ? op : run(ctx.threadId, op);
      },
    },
    {
      name: "workbench_close",
      description: "Close a tab in this conversation's workbench by its key (from workbench_list).",
      parameters: z.object({ key: tabKey, force }),
      execute: async (input: { key: string; force?: boolean }, ctx: { threadId: string }) => run(ctx.threadId, { type: "close", key: input.key, force: input.force === true }),
    },
    {
      name: "workbench_focus",
      description: "Select a tab in this conversation's workbench by its key (from workbench_list), showing the panel. Refused while the user is typing in the panel.",
      parameters: z.object({ key: tabKey, force }),
      execute: async (input: { key: string; force?: boolean }, ctx: { threadId: string }) => run(ctx.threadId, { type: "focus", key: input.key, force: input.force === true }),
    },
    {
      name: "workbench_pop_out",
      description: `Open a tab of this conversation's workbench in a window of its own, by its key (from workbench_list); it leaves the workbench, and the window's Return to workbench puts it back. ${WINDOW_KINDS} Refused while the user is typing in the panel.`,
      parameters: z.object({ key: tabKey, force }),
      execute: async (input: { key: string; force?: boolean }, ctx: { threadId: string }) => run(ctx.threadId, { type: "popOut", key: input.key, force: input.force === true }),
    },
    {
      name: "workbench_arrange",
      description: `Arrange this conversation's workbench: side by side (the workbench beside the chat), panel only, or conversation only; its width (${MIN_WIDTH_PERCENT} to ${MAX_WIDTH_PERCENT}% of the view); one or two panes and their widths. ${PANE_LIMITS} A setting the user changed after you set it stays theirs.`,
      parameters: arrangeInput,
      execute: async (input: z.infer<typeof arrangeInput>, ctx: { threadId: string }) => {
        if (input.layout === "stacked") return STACKED;
        if (!input.layout && input.widthPercent === undefined && input.panes === undefined && !input.paneWidths) return "Give a layout, a widthPercent, panes, paneWidths, or several.";
        const layout: Partial<WorkbenchLayout> = {
          ...(input.layout ? LAYOUTS[input.layout] : {}),
          ...(input.widthPercent !== undefined ? { widthPercent: input.widthPercent } : {}),
          ...(input.panes !== undefined ? { panes: input.panes } : {}),
          ...(input.paneWidths ? { paneWidths: input.paneWidths } : {}),
        };
        return run(ctx.threadId, { type: "arrange", layout, force: input.force === true });
      },
    },
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

/** Registers the tools and the window's RPCs. */
export function registerWorkbenchAgent(bb: BbPluginApi, deps: { itemTitle(id: string): string | null; botName(id: string): string | null; entryTitle(kind: "automation" | "todo" | "record", id: string): Promise<string | null> }): void {
  const router = new WorkbenchRouter((command) => { void bb.realtime.publish(WORKBENCH_CHANNEL, command as never); });
  bb.onDispose(() => router.dispose());
  const records = new WorkbenchRecords();
  bb.rpc.register(workbenchContract, {
    "workbench.claim": ({ requestId }) => ({ go: router.claim(requestId) }),
    "workbench.reply": ({ requestId, message, record }) => ({ ok: router.reply(requestId, message, record) }),
  });
  const place = async (threadId: string): Promise<ThreadPlace> => {
    const thread = (await bb.sdk.threads.get({ threadId }).catch(() => null)) as { environmentId?: string | null } | null;
    const environmentId = thread?.environmentId ?? null;
    if (!environmentId) return { environmentId: null, hostId: null, root: null };
    const environment = (await bb.sdk.environments.get({ environmentId }).catch(() => null)) as { hostId?: string; path?: string | null } | null;
    return { environmentId, hostId: environment?.hostId ?? null, root: environment?.path ?? null };
  };
  const primaryHostId = async () => ((await bb.sdk.system.config().catch(() => null)) as { primaryHostId?: string } | null)?.primaryHostId ?? null;
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
  const tools = workbenchTools({ router, records, ...lookups });
  for (const tool of tools) bb.agents.registerTool(tool as never);
}
