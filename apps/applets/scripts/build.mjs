// Bundles the shell: main and preload (CommonJS for Electron), and the
// applet kit (ESM, served at studio://kit/).
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(here, "dist");
const require = createRequire(import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(join(out, "kit"), { recursive: true });

// One React for the kit, even though the Studio kit's sources sit in another package.
const alias = {
  react: dirname(require.resolve("react/package.json")),
  "react-dom": dirname(require.resolve("react-dom/package.json")),
  // BB's plugin runtime isn't in applets; the kit's icons come from Lucide instead.
  "@get-bb/plugin-sdk/app": join(here, "src/kit/sdk-shim.tsx"),
};

// Shared sources from packages/ resolve their imports here too, so a plain
// `npm install` in this folder is enough to build.
const nodePaths = [join(here, "node_modules")];
const node = { nodePaths, bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], sourcemap: true, logLevel: "warning" };
await build({ ...node, entryPoints: [join(here, "src/main/index.ts")], outfile: join(out, "main.js") });
await build({ ...node, entryPoints: [join(here, "src/preload.ts")], outfile: join(out, "preload.js"), sourcemap: false });
await build({
  entryPoints: { ui: join(here, "src/kit/ui.ts"), boot: join(here, "src/kit/boot.ts") },
  outdir: join(out, "kit"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome140",
  minify: true,
  alias,
  nodePaths,
  define: { "process.env.NODE_ENV": '"production"' },
  jsx: "automatic",
  logLevel: "warning",
});
await copyFile(require.resolve("@tailwindcss/browser"), join(out, "kit", "tailwind.js"));
console.log("built dist/");
