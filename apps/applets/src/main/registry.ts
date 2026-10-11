// Loads applets from the applets folder and watches it. The manifest rules
// are the plugin's own module, so the shell and the plugin can't disagree.
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { APPLET_ID, newCapabilities, parseManifest, type AppletManifest } from "../../../../packages/bb-studio-applets/src/manifest";
import { appletDir, grantsPath, root } from "./paths";

export type Applet = {
  id: string;
  dir: string;
  manifest: AppletManifest;
  /** Approved capabilities that the manifest still asks for. */
  granted: Set<string>;
  /** Capabilities the manifest asks for that the user hasn't approved. */
  pending: string[];
};

export type Broken = { id: string; errors: string[] };

export async function readGrants(): Promise<Record<string, string[]>> {
  try {
    const parsed = JSON.parse(await readFile(grantsPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
  } catch {
    return {};
  }
}

export async function loadApplets(): Promise<{ applets: Applet[]; broken: Broken[] }> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const grants = await readGrants();
  const applets: Applet[] = [];
  const broken: Broken[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !APPLET_ID.test(entry.name)) continue;
    const id = entry.name;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(appletDir(id), "manifest.json"), "utf8"));
    } catch (error) {
      broken.push({ id, errors: [`manifest.json: ${error instanceof Error ? error.message : String(error)}`] });
      continue;
    }
    const parsed = parseManifest(raw);
    if (!parsed.ok) broken.push({ id, errors: parsed.errors });
    else if (parsed.manifest.id !== id) broken.push({ id, errors: [`id "${parsed.manifest.id}" doesn't match the folder name`] });
    else {
      const approved = grants[id] ?? [];
      applets.push({
        id,
        dir: appletDir(id),
        manifest: parsed.manifest,
        granted: new Set(parsed.manifest.capabilities.filter((capability) => approved.includes(capability))),
        pending: newCapabilities(parsed.manifest.capabilities, approved),
      });
    }
  }
  applets.sort((a, b) => a.id.localeCompare(b.id));
  return { applets, broken };
}

/**
 * Calls `onChange(ids)` with the applet ids whose files changed (or "*" for
 * grants), debounced. Logs, data and the socket don't count.
 */
export function watchApplets(onChange: (ids: Set<string>) => void): FSWatcher | null {
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  try {
    return watch(root, { recursive: true }, (_event, file) => {
      if (!file) return;
      const [first, second] = String(file).split(/[/\\]/);
      if (!first || first.startsWith(".") || first === "shell.sock" || first === "token") return;
      if (second === "data") return;
      pending.add(first === "grants.json" ? "*" : first);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const ids = pending;
        pending = new Set();
        onChange(ids);
      }, 150);
    });
  } catch {
    return null;
  }
}
