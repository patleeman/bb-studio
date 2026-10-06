// The read-only file browser for devices that can't reach VS Code. Paths are
// resolved through symlinks and must stay inside one of the workspace's
// folders.
import { open, readdir, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

export const MAX_READ_BYTES = 1024 * 1024;
const MAX_ENTRIES = 2000;

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** The real path, if it lies inside one of the folders. */
export async function contained(folders: string[], path: string): Promise<string> {
  const real = await realpath(path).catch(() => null);
  if (!real) throw new Error("That file or folder doesn't exist.");
  for (const folder of folders) {
    const root = await realpath(folder).catch(() => null);
    if (root && inside(root, real)) return real;
  }
  throw new Error("That path is outside this workspace's folders.");
}

export async function listDir(folders: string[], path: string): Promise<{ name: string; path: string; dir: boolean }[]> {
  const real = await contained(folders, path);
  const entries = await readdir(real, { withFileTypes: true });
  const listed = await Promise.all(entries.slice(0, MAX_ENTRIES).map(async (entry) => {
    const full = join(real, entry.name);
    // Follow symlinks for their kind; the next call checks where they lead.
    const dir = entry.isDirectory() || (entry.isSymbolicLink() && (await stat(full).catch(() => null))?.isDirectory() === true);
    return { name: entry.name, path: full, dir };
  }));
  return listed.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

export async function readText(folders: string[], path: string): Promise<{ text: string | null; reason: string | null }> {
  const real = await contained(folders, path);
  const info = await stat(real);
  if (info.isDirectory()) return { text: null, reason: "That's a folder." };
  if (info.size > MAX_READ_BYTES) return { text: null, reason: "This file is over 1 MB. Open it in VS Code on the computer running BB." };
  const handle = await open(real, "r");
  try {
    const bytes = await handle.readFile();
    if (bytes.includes(0)) return { text: null, reason: "This file isn't text." };
    return { text: bytes.toString("utf8"), reason: null };
  } finally {
    await handle.close();
  }
}
