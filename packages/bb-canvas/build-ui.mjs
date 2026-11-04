#!/usr/bin/env node
// Builds the canvas page (src/ui/panel.tsx) into one file, ui/canvas-ui.js,
// which app.tsx loads. The page reuses Studio's source (Dashboards' widget
// renderers, markdown, theme, kit helpers; src/ui/studio.ts), and those
// files import npm packages that BB's install-time build can't resolve
// from Studio's folder. So the canvas bundles them here, where its own
// node_modules has them, and commits the result, as Studio does its mini
// apps' shelf. React, React DOM and the SDK stay external: BB provides them.
// The bundle is in the plugin's own files, so `bb plugin build` also finds
// its Tailwind classes.
//
//   node build-ui.mjs   (in packages/bb-canvas, after changing src/ui or the Studio files it uses)
import { build } from "esbuild";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(here, "ui", "canvas-ui.js");
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
  external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@get-bb/plugin-sdk", "@get-bb/plugin-sdk/app"],
  logLevel: "warning",
});
console.log(`${outfile}: ${(statSync(outfile).size / 1024).toFixed(0)} KB`);
