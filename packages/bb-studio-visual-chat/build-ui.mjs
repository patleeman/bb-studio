#!/usr/bin/env node
// Builds the canvas page (src/ui/panel.tsx) into one file, bundle/canvas-ui.js,
// which app.tsx loads. The page reuses Studio's source (Dashboards' widget
// renderers, markdown, theme, kit helpers; src/ui/studio.ts), and those
// files import npm packages that BB's install-time build can't resolve
// from Studio's folder. So the canvas bundles them here, where its own
// node_modules has them, and commits the result, as Studio does its mini
// apps' shelf. React, React DOM and the SDK stay external: BB provides them.
// The bundle is in the plugin's own files, so `bb plugin build` also finds
// its Tailwind classes.
//
// It also builds the board renderer (src/ui/renderer-entry.ts) into bundle/canvas-renderer.js: one classic
// script, no imports, for the iOS app's web view, which gets it from canvas.renderer (src/renderer.ts).
//
//   node build-ui.mjs   (in packages/bb-studio-visual-chat, after changing src/ui or the Studio files it uses)
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const EXTERNAL = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@get-bb/plugin-sdk", "@get-bb/plugin-sdk/app"];
// CommonJS packages in the bundle require("react"); an ES module can't
// require an external, so each such require gets a tiny ES module that
// imports the host's copy and hands it over.
const requireShims = {
  name: "require-shims",
  setup(build) {
    const filter = new RegExp(`^(${EXTERNAL.map((name) => name.replace(/[/.]/g, "\\$&")).join("|")})$`);
    build.onResolve({ filter }, (args) => (args.kind === "require-call" ? { path: args.path, namespace: "require-shim" } : { path: args.path, external: true }));
    build.onLoad({ filter: /.*/, namespace: "require-shim" }, (args) => ({
      contents: `import * as all from ${JSON.stringify(args.path)};\nexport * from ${JSON.stringify(args.path)};\nexport default all.default ?? all;`,
      loader: "js",
    }));
  },
};
const outfile = join(here, "bundle", "canvas-ui.js");
await build({
  entryPoints: [join(here, "src", "ui", "panel.tsx")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  legalComments: "eof",
  plugins: [requireShims],
  logLevel: "warning",
});
console.log(`${outfile}: ${(statSync(outfile).size / 1024).toFixed(0)} KB`);
// The renderer: framework-free (no React, no SDK), so nothing is external.
const rendererFile = join(here, "bundle", "canvas-renderer.js");
await build({
  entryPoints: [join(here, "src", "ui", "renderer-entry.ts")],
  outfile: rendererFile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  logLevel: "warning",
});
const version = createHash("sha256").update(readFileSync(rendererFile, "utf8")).digest("hex").slice(0, 16);
console.log(`${rendererFile}: ${(statSync(rendererFile).size / 1024).toFixed(0)} KB, version ${version}`);
