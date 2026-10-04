// Where a saved file comes from. An agent names a path; we only read it if
// it's inside that thread's workspace or its thread storage, and we read it
// with the root set so the host refuses symlinks that lead outside it.
import { posix } from "node:path";

export interface SourceRoot {
  kind: "workspace" | "storage";
  hostId: string;
  path: string;
}

export interface ResolvedSource {
  root: SourceRoot;
  /** Absolute path on the root's host. */
  path: string;
}

/**
 * Resolves `input` against the thread's roots. Relative paths are taken from
 * `cwd` when it's inside a root, else from the workspace, else from thread
 * storage. Returns an error message instead of a path outside every root.
 */
export function resolveSource(
  input: string,
  roots: readonly SourceRoot[],
  cwd?: string | null,
): ResolvedSource | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "Give a file path." };
  if (raw.includes("\0")) return { error: "That path isn't valid." };
  if (!roots.length) return { error: "This thread has no workspace or thread storage to read from." };
  if (raw.endsWith("/")) return { error: `${raw} is a folder, not a file.` };

  let absolute: string;
  if (raw.startsWith("/")) {
    absolute = posix.normalize(raw);
  } else if (raw.startsWith("~")) {
    return { error: "Use a path inside the thread's workspace or thread storage, not your home directory." };
  } else {
    const base = cwd && roots.some((root) => within(root.path, posix.normalize(cwd))) ? posix.normalize(cwd) : roots[0]!.path;
    absolute = posix.normalize(posix.join(base, raw));
  }

  // The most specific root wins: thread storage can live inside a workspace.
  const root = [...roots]
    .sort((a, b) => b.path.length - a.path.length)
    .find((candidate) => within(candidate.path, absolute));
  if (!root) return { error: `${raw} is outside this thread's workspace and thread storage.` };
  if (absolute === posix.normalize(root.path)) return { error: `${raw} is a folder, not a file.` };
  return { root, path: absolute };
}

function within(root: string, path: string): boolean {
  const base = posix.normalize(root).replace(/\/+$/, "");
  return path === base || path.startsWith(`${base}/`);
}

/** The path to show and to key versions on: relative to its root. */
export function displayPath(source: ResolvedSource): string {
  const base = posix.normalize(source.root.path).replace(/\/+$/, "");
  const relative = source.path.slice(base.length + 1);
  return source.root.kind === "storage" ? `thread-storage/${relative}` : relative;
}
