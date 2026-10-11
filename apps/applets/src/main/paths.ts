// Where the shell reads and writes. The applets folder is shared with the
// applets plugin (packages/bb-studio-applets), which writes applet folders
// and grants.json; the shell writes logs, the socket and its token.
import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";

export const root = process.env.STUDIO_APPLETS_DIR || join(homedir(), ".bb-studio", "applets");
export const grantsPath = join(root, "grants.json");
export const logsDir = join(root, ".logs");
export const socketPath = join(root, "shell.sock");
export const tokenPath = join(root, "token");

export function appletDir(id: string): string {
  return join(root, id);
}

export function dataDir(id: string): string {
  return join(root, id, "data");
}

/** A path inside `base`, or null if `relative` escapes it. */
export function resolveInside(base: string, relative: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative).replace(/^\/+/, "");
  } catch {
    return null;
  }
  const full = normalize(join(base, decoded));
  return full === base || full.startsWith(base.endsWith(sep) ? base : base + sep) ? full : null;
}
