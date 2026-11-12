// Names, schemas and links the server and the app share.
import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { bbThemeSchema } from "./code-theme";

// The SDK's defineRpcContract, inlined: the app bundles this file, and BB
// doesn't serve the bare SDK to frontends.
const defineRpcContract = <const Contract extends PluginRpcContract>(contract: Contract): Contract => contract;

export const PLUGIN_ID = "studio-code";
export const CODE_ICON = "Code";
/** Realtime channel; payload `{ id }` when a workspace or its server changed. */
export const CHANNEL = "studio-code-changed";
export const ID_PREFIX = "cws";
/** The VS Code tab's action id. */
export const CODE_TAB = "code";

/**
 * Which folder a VS Code tab opens: a worktree or checkout (a BB environment),
 * or a project's own folder. BB tells tab instances apart by their params as
 * JSON, so these are always built here, with one key.
 */
export type CodeTabParams = { environmentId: string } | { projectId: string };

/** The tab params for a folder: the environment when there is one, else the project; null with neither. */
export function codeTabParams(folder: { environmentId?: string | null; projectId?: string | null }): CodeTabParams | null {
  if (folder.environmentId) return { environmentId: folder.environmentId };
  if (folder.projectId) return { projectId: folder.projectId };
  return null;
}

/** Tab params as BB hands them back, checked; null for a tab opened without any (the per-thread tab). */
export function parseCodeTabParams(params: unknown): CodeTabParams | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const { environmentId, projectId } = params as { environmentId?: unknown; projectId?: unknown };
  return codeTabParams({ environmentId: typeof environmentId === "string" ? environmentId : null, projectId: typeof projectId === "string" ? projectId : null });
}

/** A workspace's stable identity: the folder it opens, whichever thread asked. */
export function folderKey(params: CodeTabParams): string {
  return "environmentId" in params ? `env:${params.environmentId}` : `project:${params.projectId}`;
}

/** The tab params for a workspace's folder key; null for a workspace made for one thread. */
export function tabParamsOfKey(key: string | null): CodeTabParams | null {
  if (key?.startsWith("env:")) return codeTabParams({ environmentId: key.slice(4) });
  if (key?.startsWith("project:")) return codeTabParams({ projectId: key.slice(8) });
  return null;
}

/** A VS Code tab's icon by what it opens (`experimental_instanceIcon`): a branch for a worktree, a folder for a project. */
export function codeTabIcon(params: unknown): string | null {
  const folder = parseCodeTabParams(params);
  return folder ? ("environmentId" in folder ? "GitBranch" : "Folder") : null;
}
/** VS Code stops after this long with no editor open. */
export const IDLE_TIMEOUT_SECONDS = 30 * 60;
/** A view out of sight this long lets go of its editor, so the idle timer can run. */
export const HIDDEN_RELEASE_MS = 5 * 60 * 1000;

const id = z.string().min(1).max(100);

export const workspaceSchema = z.object({
  id,
  title: z.string(),
  projectId: z.string().nullable(),
  /** The thread this workspace was made for, before workspaces were shared by folder. */
  threadId: z.string().nullable(),
  /** The folder it opens (`env:<id>` or `project:<id>`): every thread on that folder shares it. Null for an older per-thread one. */
  folderKey: z.string().nullable(),
  /**
   * The user chose these folders (or they're a thread's own worktree), so
   * VS Code skips workspace trust. Folders an agent names stay untrusted.
   */
  trusted: z.boolean(),
  /** Agents in related threads see what the user has open here. */
  share: z.boolean(),
  folders: z.array(z.string()),
  archived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

/** One workspace's editor server. */
export const serverStatusSchema = z.object({
  state: z.enum(["stopped", "installing", "starting", "running", "failed"]),
  /** Where the editor answers, once running. */
  url: z.string().nullable(),
  /** This run's password; the panel signs the editor in with it. */
  password: z.string().nullable(),
  error: z.string().nullable(),
});
export type ServerStatus = z.infer<typeof serverStatusSchema>;

const line = z.number().int().min(1);
/** What the user has in front of them in VS Code, as the bridge extension reports it. */
export const editorStateSchema = z.object({
  /** The window has focus. */
  focused: z.boolean(),
  activeFile: z.object({
    path: z.string().max(4096),
    language: z.string().max(100),
    selection: z.object({ startLine: line, startColumn: line, endLine: line, endColumn: line }),
    /** The selected text, cut to a few thousand characters. */
    selectedText: z.string().max(8000),
    visible: z.object({ startLine: line, endLine: line }).nullable(),
    problems: z.array(z.object({ line, severity: z.enum(["error", "warning"]), message: z.string().max(400) })).max(20),
  }).nullable(),
  openFiles: z.array(z.string().max(4096)).max(50),
  /** Files with edits not yet saved: on disk they're older than what the user sees. */
  unsavedFiles: z.array(z.string().max(4096)).max(50),
});
export type EditorState = z.infer<typeof editorStateSchema>;

/** What BB's page is asked to open for the editor that has the keyboard (realtime `{ type: "open", id, open }`). */
export type EditorOpen =
  | { kind: "thread"; threadId: string }
  /** BB's own file preview at a line. `target` is the SDK's live file target. */
  | { kind: "file"; target: { kind: "workspace"; environmentId: string; path: string } | { kind: "host"; hostId: string; path: string }; line: number };

export const codeContract = defineRpcContract({
  get: {
    input: z.object({ id }),
    output: z.object({ workspace: workspaceSchema.nullable(), status: serverStatusSchema }),
  },
  update: {
    input: z.object({ id, share: z.boolean() }),
    output: z.object({ workspace: workspaceSchema }),
  },
  /** Installs code-server if needed and starts this workspace's server. */
  open: {
    input: z.object({ id }),
    output: z.object({ status: serverStatusSchema }),
  },
  stop: {
    input: z.object({ id }),
    output: z.object({ status: serverStatusSchema }),
  },
  /** The thread's workspace if it has one; never makes one. */
  threadWorkspace: {
    input: z.object({ threadId: id }),
    output: z.object({ workspace: workspaceSchema.nullable() }),
  },
  /** The workspace of the thread's folder (its worktree, else its project), made the first time. */
  forThread: {
    input: z.object({ threadId: id }),
    output: z.object({ workspace: workspaceSchema }),
  },
  /** The workspace of a worktree (environment) or a project's folder, made the first time. */
  forFolder: {
    input: z.union([z.object({ environmentId: id }), z.object({ projectId: id })]),
    output: z.object({ workspace: workspaceSchema }),
  },
  /** The workspace opened last (else changed last) whose folder is still there, archived ones aside; null with none. */
  recent: {
    input: z.null(),
    output: z.object({ workspace: workspaceSchema.nullable() }),
  },
  /**
   * The live workspaces, the one opened last first, for the picker shown when
   * there is nothing to open. `missing`: its folder is gone from this computer.
   */
  list: {
    input: z.null(),
    output: z.object({ workspaces: z.array(workspaceSchema.extend({ missing: z.boolean() })) }),
  },
  /** A folder's entries, for the read-only browser where VS Code can't run. */
  listDir: {
    input: z.object({ id, path: z.string().max(4096) }),
    output: z.object({ entries: z.array(z.object({ name: z.string(), path: z.string(), dir: z.boolean() })) }),
  },
  readFile: {
    input: z.object({ id, path: z.string().max(4096) }),
    output: z.object({ text: z.string().nullable(), reason: z.string().nullable() }),
  },
  /**
   * Opens a file at lines in the workspace's editor, as code_show does for
   * agents: for links into code, and for README captures. Held until an
   * editor connects.
   */
  reveal: {
    input: z.object({ id, path: z.string().min(1).max(4096), startLine: z.number().int().min(1), endLine: z.number().int().min(1).optional() }),
    output: z.object({ shown: z.boolean() }),
  },
  /** A thread's VS Code tab is showing the workspace: its review comments go to that thread. */
  viewedFrom: {
    input: z.object({ id, threadId: id }),
    output: z.object({ ok: z.literal(true) }),
  },
  /** What the workspace's VS Code reports, as the agent sees it; null with no editor open. */
  editorState: {
    input: z.object({ id }),
    output: z.object({ state: editorStateSchema.nullable() }),
  },
  /** BB's palette, as the app sees it; every workspace follows it. */
  syncTheme: {
    input: bbThemeSchema,
    /**
     * `changed`: the theme was new to the server. Open editors restyle in
     * place; `reload`: some open editor is too old to, so its frame reloads.
     */
    output: z.object({ changed: z.boolean(), reload: z.boolean() }),
  },
});
export type CodeContract = typeof codeContract;
