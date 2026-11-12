import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const PATTERNS = [/src\/hud\b/, /["'`]hud\.\w+["'`]/, /\bhud(Enabled|Hotkey)\b/, /\bHUD_WINDOW_ID\b/, /\bid:\s*["']hud["']/, /Show HUD|Pop out to HUD|Bot HUD/, /\bHud[A-Z]\w*/];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it("has no HUD: no src/hud, and no HUD window, RPC, setting, menu item or component registered anywhere", () => {
  expect(existsSync(join(ROOT, "src/hud"))).toBe(false);
  const files = [join(ROOT, "app.tsx"), join(ROOT, "server.ts"), ...sources(join(ROOT, "src"))];
  const hits = files.flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) => (PATTERNS.some((pattern) => pattern.test(line)) ? [`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`] : [])));
  expect(hits).toEqual([]);
});
