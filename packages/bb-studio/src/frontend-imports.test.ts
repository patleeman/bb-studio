// An installed plugin's frontend bundle can't resolve "@get-bb/plugin-sdk"
// (only its /app entry), so BB refuses the install. A value import of a
// server contract from the UI pulled it in once; walk app.tsx's imports.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageDir = resolve(__dirname, "..");
const importPattern = /^\s*(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+"([^"]+)"/gms;
const typeOnly = /^\{\s*(?:type\s+[\w$]+(?:\s+as\s+[\w$]+)?\s*,?\s*)+\}$/;

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function rootSdkImporters(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, clause, spec] of readFileSync(file, "utf8").matchAll(importPattern)) {
      if (typeOnly.test(clause.trim())) continue;
      if (spec === "@get-bb/plugin-sdk") found.push(relative(packageDir, file));
      if (spec.startsWith(".")) {
        const next = resolveLocal(file, spec);
        if (next) walk(next);
      }
    }
  };
  walk(entry);
  return found;
}

describe("frontend bundle", () => {
  it("never imports the root plugin SDK", () => {
    expect(rootSdkImporters(join(packageDir, "app.tsx"))).toEqual([]);
  });
});
