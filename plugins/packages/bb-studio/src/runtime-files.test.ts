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

const files = [join(root, "server.ts"), ...sources(join(root, "src"))];

it("lists every file the server reads through runtimeFile, so the built-in copy ships it", () => {
  const bundled = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(/runtimeFile\("([^"]+)"(?:,\s*"([^"]+)")?\)/g)) bundled.add(match[2] ?? match[1]!);
  }
  expect(bundled.size).toBeGreaterThan(0);
  for (const path of bundled) expect(listed, path).toContain(path);
  expect(listed).toContain("@excalidraw/excalidraw/dist/prod/fonts");
  for (const entry of listed) expect(existsSync(join(root, "node_modules", entry)), entry).toBe(true);
});

it("resolves no runtime file from node_modules except through runtimeFile", () => {
  const direct = files.filter((file) => !file.endsWith("runtime-file.ts") && /createRequire\(import\.meta\.url\)\.resolve\(/.test(readFileSync(file, "utf8")));
  expect(direct).toEqual([]);
});
