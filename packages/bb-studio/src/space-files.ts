// A space's files: the worktrees of its threads, read through the host so
// remote environments work too. Studio shows them in a Files view instead of
// listing code workspaces among the space's documents.
import { posix } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { resolveSource, threadRoots } from "@bb-studio/kit/server";

export const MAX_FILES = 5000;
export const MAX_READ_BYTES = 1024 * 1024;
/** How many of a space's newest threads to look up a worktree for. */
const WORKTREE_THREADS = 20;

export interface Worktree {
  threadId: string;
  title: string;
  updatedAt: number;
  path: string;
}

type Sdk = Pick<BbPluginApi, "sdk">;

/** Worktrees of the newest threads, one per folder, newest first. */
export async function worktrees(bb: Sdk, threads: readonly { id: string; title: string; updatedAt: number }[]): Promise<Worktree[]> {
  const newest = [...threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, WORKTREE_THREADS);
  const found = await Promise.all(
    newest.map(async (thread) => {
      const full = (await bb.sdk.threads.get({ threadId: thread.id, include: "environment" }).catch(() => null)) as { environment?: { path: string | null } | null } | null;
      const path = full?.environment?.path;
      return path ? { threadId: thread.id, title: thread.title, updatedAt: thread.updatedAt, path } : null;
    }),
  );
  const seen = new Set<string>();
  return found.filter((each): each is Worktree => each !== null && !seen.has(each.path) && Boolean(seen.add(each.path)));
}

async function workspaceRoot(bb: Sdk, threadId: string) {
  const root = (await threadRoots(bb, threadId)).roots.find((each) => each.kind === "workspace");
  if (!root) throw new Error("This thread has no worktree to show.");
  return root;
}

/** Every file in the thread's worktree that git doesn't ignore, as paths relative to it. */
export async function listFiles(bb: Sdk, threadId: string): Promise<{ root: string; files: string[]; truncated: boolean }> {
  const root = await workspaceRoot(bb, threadId);
  const base = posix.normalize(root.path).replace(/\/+$/, "");
  const result = await bb.sdk.files.list({ hostId: root.hostId, path: root.path, limit: MAX_FILES, excludeNames: [".git", "node_modules"] });
  const files = result.files
    .map((file) => (file.path.startsWith(`${base}/`) ? file.path.slice(base.length + 1) : file.path.replace(/^\/+/, "")))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return { root: root.path, files, truncated: result.truncated };
}

/** A file's text, or why it can't be shown. The host refuses symlinks out of the worktree. */
export async function readFile(bb: Sdk, threadId: string, path: string): Promise<{ text: string | null; reason: string | null }> {
  const root = await workspaceRoot(bb, threadId);
  const source = resolveSource(path, [root]);
  if ("error" in source) return { text: null, reason: source.error };
  const file = await bb.sdk.files.read({ hostId: root.hostId, rootPath: root.path, path: source.path });
  const bytes = file.contentEncoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
  if (bytes.length > MAX_READ_BYTES) return { text: null, reason: "This file is over 1 MB." };
  if (bytes.includes(0)) return { text: null, reason: "This file isn't text." };
  return { text: bytes.toString("utf8"), reason: null };
}

/** Only a thread that belongs to the space may have its worktree read through it. */
export async function requireThreadInSpace(
  bb: Sdk,
  ownerOf: (thread: { id: string; projectId: string | null }) => string,
  spaceId: string,
  threadId: string,
): Promise<void> {
  const thread = (await bb.sdk.threads.get({ threadId }).catch(() => null)) as { projectId?: string | null } | null;
  if (!thread || ownerOf({ id: threadId, projectId: thread.projectId ?? null }) !== spaceId) {
    throw new Error("That thread isn't in this space.");
  }
}
