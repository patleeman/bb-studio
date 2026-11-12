import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const listed: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).studioRuntimeFiles;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

it("lists every file the server resolves at run time, so the built-in copy ships it", () => {
  const resolved = new Set<string>();
  for (const file of [join(root, "server.ts"), ...sources(join(root, "src"))]) {
    for (const match of readFileSync(file, "utf8").matchAll(/createRequire\(import\.meta\.url\)\.resolve\("([^"]+)"\)/g)) resolved.add(match[1]!);
  }
  expect(resolved.size).toBeGreaterThan(0);
  for (const target of resolved) {
    expect(listed.some((entry) => entry === target || entry.startsWith(`${target}/`)), target).toBe(true);
  }
  for (const entry of listed) expect(existsSync(join(root, "node_modules", entry)), entry).toBe(true);
});
