// Names, schemas and links the server and the app share.
import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { bbThemeSchema } from "./theme";

// The SDK's defineRpcContract, inlined: the app bundles this file, and BB
// doesn't serve the bare SDK to frontends.
const defineRpcContract = <const Contract extends PluginRpcContract>(contract: Contract): Contract => contract;

export const PLUGIN_ID = "studio-code";
/** The nav panel: /plugins/studio-code/workspaces, and workspaces/<id> for one. */
export const PANEL_PATH = "workspaces";
export const KIND_ID = "code-workspace";
export const CODE_ICON = "Code";
/** Realtime channel; payload `{ id }` when a workspace or its server changed. */
export const CHANNEL = "studio-code-changed";
export const ID_PREFIX = "cws";
/** The workbench tab's action id; reply cards open it with `{ workspaceId }`. */
export const CODE_TAB = "code";
/** VS Code stops after this long with no editor open. */
export const IDLE_TIMEOUT_SECONDS = 30 * 60;
/** A view out of sight this long lets go of its editor, so the idle timer can run. */
export const HIDDEN_RELEASE_MS = 5 * 60 * 1000;

export function workspaceHref(id: string): string {
  return `/plugins/${PLUGIN_ID}/${PANEL_PATH}/${id}`;
}

export function isWorkspaceId(id: string): boolean {
  return id.startsWith(`${ID_PREFIX}_`);
}

const id = z.string().min(1).max(100);
const folder = z.string().trim().min(1).max(4096);

export const workspaceSchema = z.object({
  id,
  title: z.string(),
  projectId: z.string().nullable(),
  /** The thread whose worktree this workspace opens, if it was made for one. */
  threadId: z.string().nullable(),
  /**
   * The user chose these folders (or they're a thread's own worktree), so
   * VS Code skips workspace trust. Folders an agent names stay untrusted.
   */
  trusted: z.boolean(),
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

export const codeContract = defineRpcContract({
  get: {
    input: z.object({ id }),
    output: z.object({ workspace: workspaceSchema.nullable(), status: serverStatusSchema }),
  },
  update: {
    input: z.object({ id, title: z.string().trim().max(200).optional(), folders: z.array(folder).max(50).optional() }),
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
  /** The thread's worktree workspace, made the first time. */
  forThread: {
    input: z.object({ threadId: id }),
    output: z.object({ workspace: workspaceSchema }),
  },
  /** A folder's entries, for the read-only browser where VS Code can't run. */
  listDir: {
    input: z.object({ id, path: z.string().max(4096) }),
    output: z.object({ entries: z.array(z.object({ name: z.string(), path: z.string(), dir: z.boolean() })) }),
  },
  /** A folder's subfolders, for the folder picker; null starts at home. */
  browseFolders: {
    input: z.object({ path: z.string().max(4096).nullable(), showHidden: z.boolean() }),
    output: z.object({
      path: z.string(),
      parent: z.string().nullable(),
      choosable: z.boolean(),
      folders: z.array(z.object({ name: z.string(), path: z.string(), choosable: z.boolean() })),
    }),
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
  /** The thread header's VS Code chip: the workspace it opens (null: the thread's worktree), or no chip. */
  threadChip: {
    input: z.object({ threadId: id }),
    output: z.object({ chip: z.object({ workspaceId: z.string().nullable(), title: z.string(), working: z.boolean() }).nullable() }),
  },
  /** What the workspace's VS Code reports, as the agent sees it; null with no editor open. */
  editorState: {
    input: z.object({ id }),
    output: z.object({ state: editorStateSchema.nullable() }),
  },
  /** BB's palette, as the app sees it; every workspace follows it. */
  syncTheme: {
    input: bbThemeSchema,
    /** `changed`: the workspaces' settings were rewritten, so open editors should reload. */
    output: z.object({ changed: z.boolean() }),
  },
  /** BB's projects with a local folder, to pick from. */
  projects: {
    input: z.null(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })) }),
  },
});
export type CodeContract = typeof codeContract;
