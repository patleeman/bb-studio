// Writes BB's theme into each workspace's VS Code settings, keeping every
// other setting. VS Code watches settings.json, so an open editor recolors
// without a reload.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { themeSettings, type BbTheme } from "../theme";

/**
 * The settings text with `patch` applied, or null when the file isn't plain
 * JSON (VS Code allows comments), so the user's own file is never mangled.
 */
export function mergeSettings(text: string | null, patch: Record<string, unknown>): string | null {
  let current: Record<string, unknown> = {};
  if (text?.trim()) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      current = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const next = { ...current, ...patch };
  const out = `${JSON.stringify(next, null, 2)}\n`;
  return out === text ? text : out;
}

/** A workspace's settings folder. */
export const settingsDir = (workspaceDir: string) => join(workspaceDir, "user-data", "User");

/** Applies the theme to one workspace; false when its settings couldn't be read as JSON. */
export async function applyTheme(workspaceDir: string, theme: BbTheme): Promise<boolean> {
  const dir = settingsDir(workspaceDir);
  const file = join(dir, "settings.json");
  const text = existsSync(file) ? await readFile(file, "utf8") : null;
  const next = mergeSettings(text, themeSettings(theme));
  if (next === null) return false;
  if (next !== text) {
    await mkdir(dir, { recursive: true });
    await writeFile(file, next);
  }
  return true;
}

/** Applies the theme to every workspace folder under `root/workspaces`. */
export async function applyThemeEverywhere(root: string, theme: BbTheme, warn: (message: string) => void): Promise<void> {
  const base = join(root, "workspaces");
  const ids = existsSync(base) ? await readdir(base) : [];
  for (const id of ids) {
    if (!(await applyTheme(join(base, id), theme).catch(() => false))) warn(`workspace ${id}: settings.json isn't plain JSON; left its colors alone`);
  }
}
