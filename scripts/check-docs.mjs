#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packages = join(root, "packages");
const errors = [];
const exists = (path) => stat(path).then(() => true, () => false);
for (const packageDir of await readdir(packages)) {
  const base = join(packages, packageDir);
  const readme = join(base, "README.md");
  let manifest = null;
  try { manifest = JSON.parse(await readFile(join(base, "package.json"), "utf8")); } catch {}
  // Every plugin needs a README; a library without one has nothing to check.
  if (!(await exists(readme))) {
    if (manifest?.bb?.name) errors.push(`${packageDir}: plugin has no README.md`);
    continue;
  }
  const screenshot = join(base, "assets", "staged-preview.png");
  const text = await readFile(readme, "utf8");
  // The screenshot must be an image in the Staged preview section itself.
  const section = /^## Staged preview[ \t]*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1];
  if (section === undefined) errors.push(`${packageDir}: missing Staged preview section`);
  else if (!/!\[[^\]]*\]\((?:\.\/)?assets\/staged-preview\.png\)/.test(section)) errors.push(`${packageDir}: Staged preview section has no assets/staged-preview.png image`);
  try {
    const bytes = await readFile(screenshot);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) errors.push(`${packageDir}: screenshot is not a PNG`);
  } catch { errors.push(`${packageDir}: missing screenshot`); }
  // Relative links and images must point at files that exist.
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0]);
    if (path && !(await exists(resolve(dirname(readme), path)))) errors.push(`${packageDir}: README links to missing ${target}`);
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log("Plugin README screenshots: OK");
