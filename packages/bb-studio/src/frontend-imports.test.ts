// An installed plugin's frontend bundle can't resolve "@get-bb/plugin-sdk"
// (only its /app entry), so BB refuses the install. A value import of a
// server contract from the UI pulled it in once; walk app.tsx's imports.
// Excalidraw is the other thing to keep out of the static graph: Studio's
// app loads it (and the server resvg) only when a drawing needs it.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageDir = resolve(__dirname, "..");
const kitDir = resolve(packageDir, "../bb-studio-kit");
const kitExports: Record<string, string> = JSON.parse(readFileSync(join(kitDir, "package.json"), "utf8")).exports;
const importPattern = /^\s*(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+"([^"]+)"/gms;
const typeOnly = /^\{\s*(?:type\s+[\w$]+(?:\s+as\s+[\w$]+)?\s*,?\s*)+\}$/;

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Files that statically import `target`, following local and kit imports from `entry`. */
function importersOf(entry: string, target: (spec: string) => boolean): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, clause, spec] of readFileSync(file, "utf8").matchAll(importPattern)) {
      if (typeOnly.test(clause.trim())) continue;
      if (target(spec)) found.push(relative(packageDir, file));
      if (spec.startsWith(".")) {
        const next = resolveLocal(file, spec);
        if (next) walk(next);
      } else if (spec.startsWith("@bb-studio/kit/")) {
        // The kit ships as source, so its imports land in the bundle too.
        const target = kitExports[`./${spec.slice("@bb-studio/kit/".length)}`];
        if (target) walk(resolve(kitDir, target));
      }
    }
  };
  walk(entry);
  return found;
}

describe("frontend bundle", () => {
  it("never imports the root plugin SDK", () => {
    expect(importersOf(join(packageDir, "app.tsx"), (spec) => spec === "@get-bb/plugin-sdk")).toEqual([]);
  });

  it("loads Excalidraw only when a drawing opens", () => {
    expect(importersOf(join(packageDir, "app.tsx"), (spec) => spec.startsWith("@excalidraw/"))).toEqual([]);
  });
});

describe("server bundle", () => {
  it("loads resvg only for a PNG export", () => {
    expect(importersOf(join(packageDir, "server.ts"), (spec) => spec.startsWith("@resvg/") || spec.startsWith("@excalidraw/"))).toEqual([]);
  });
});
