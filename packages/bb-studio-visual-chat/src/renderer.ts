// The board renderer for hosts outside BB's web UI (the iOS app): bundle/canvas-renderer.js, built by
// build-ui.mjs from src/ui/renderer-entry.ts and committed, as the page bundle is. canvas.renderer serves it
// with its version, the first 16 hex of its SHA-256: the same build always has the same version, so the app
// keeps one copy per version and asks for the text only when the version it has isn't the current one.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RENDERER_FILE = "canvas-renderer.js";

export interface RendererBundle { version: string; js: string }

export const rendererVersion = (js: string) => createHash("sha256").update(js).digest("hex").slice(0, 16);

/** The bundle folder from src/ (tests, BB running the source) or from a built dist/ or the package root. */
export function rendererDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, "..", "bundle"), join(here, "bundle")];
}

/** Reads the renderer once (the first place it's found) and keeps it; a failed read is tried again next time. */
export function rendererLoader(dirs: readonly string[] = rendererDirs()) {
  let loaded: Promise<RendererBundle> | null = null;
  return () => {
    if (!loaded) {
      loaded = (async () => {
        for (const dir of dirs) {
          try {
            const js = await readFile(join(dir, RENDERER_FILE), "utf8");
            return { version: rendererVersion(js), js };
          } catch {
            // Try the next place it may be.
          }
        }
        throw new Error(`The board renderer (bundle/${RENDERER_FILE}) is missing. Run node build-ui.mjs.`);
      })();
      loaded.catch(() => { loaded = null; });
    }
    return loaded;
  };
}
