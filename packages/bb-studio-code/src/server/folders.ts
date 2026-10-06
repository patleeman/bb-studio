// Folders a workspace may not open: the whole disk, the home folder, and
// where secrets live, or any folder that contains them. The read-only file
// browser serves a workspace's folders to any BB client, so these would hand
// out keys and tokens.
import { readdir, stat } from "node:fs/promises";
import { posix } from "node:path";

const SECRETS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", ".netrc", ".npmrc", ".pypirc", ".password-store", ".config/gh", ".config/gcloud", "Library/Keychains"];

/** Why `path` can't be a workspace folder, or null when it can. */
export function sensitiveFolder(path: string, home: string): string | null {
  const folder = posix.normalize(path).replace(/\/+$/, "") || "/";
  const base = posix.normalize(home).replace(/\/+$/, "");
  if (folder === "/") return "the whole disk";
  if (folder === base) return "your home folder";
  for (const secret of SECRETS) {
    const full = `${base}/${secret}`;
    if (folder === full || folder.startsWith(`${full}/`) || full.startsWith(`${folder}/`)) return `${secret}, where secrets live`;
  }
  return null;
}

/** Whether `path` is a secret folder or inside one: the picker won't even list it. */
function insideSecret(path: string, home: string): boolean {
  const folder = posix.normalize(path).replace(/\/+$/, "") || "/";
  const base = posix.normalize(home).replace(/\/+$/, "");
  return SECRETS.some((secret) => folder === `${base}/${secret}` || folder.startsWith(`${base}/${secret}/`));
}

const MAX_LISTED = 1000;

/**
 * One folder's subfolders, for the folder picker: folders only, names
 * sorted with hidden ones last (and left out unless asked for), and never
 * secret folders. `choosable` says whether a folder could be a workspace
 * folder; the home folder and parents of secrets can be walked through.
 */
export async function browseFolders(path: string | null, home: string, showHidden: boolean): Promise<{
  path: string;
  parent: string | null;
  choosable: boolean;
  folders: { name: string; path: string; choosable: boolean }[];
}> {
  const folder = posix.normalize(path ?? home).replace(/\/+$/, "") || "/";
  if (!folder.startsWith("/")) throw new Error(`Use a full path: ${path}`);
  if (insideSecret(folder, home)) throw new Error("That folder holds secrets, so it isn't listed.");
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Not a folder on this machine: ${folder}`);
  const entries = await readdir(folder, { withFileTypes: true });
  const folders: { name: string; path: string; choosable: boolean }[] = [];
  for (const entry of entries) {
    if (folders.length >= MAX_LISTED) break;
    if (!showHidden && entry.name.startsWith(".")) continue;
    const child = posix.join(folder, entry.name);
    if (insideSecret(child, home)) continue;
    // Follow links to folders; skip everything else.
    const isFolder = entry.isDirectory() || (entry.isSymbolicLink() && (await stat(child).catch(() => null))?.isDirectory() === true);
    if (isFolder) folders.push({ name: entry.name, path: child, choosable: sensitiveFolder(child, home) === null });
  }
  folders.sort((a, b) => Number(a.name.startsWith(".")) - Number(b.name.startsWith(".")) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return {
    path: folder,
    parent: folder === "/" ? null : posix.dirname(folder),
    choosable: sensitiveFolder(folder, home) === null,
    folders,
  };
}
