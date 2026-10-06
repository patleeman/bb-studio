// Names, schemas and links the server and the app share.
import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

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
  error: z.string().nullable(),
});
export type ServerStatus = z.infer<typeof serverStatusSchema>;

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
  readFile: {
    input: z.object({ id, path: z.string().max(4096) }),
    output: z.object({ text: z.string().nullable(), reason: z.string().nullable() }),
  },
  /** BB's projects with a local folder, to pick from. */
  projects: {
    input: z.null(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })) }),
  },
});
export type CodeContract = typeof codeContract;
