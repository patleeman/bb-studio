#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packages = join(root, "packages");
const errors = [];
for (const packageDir of await readdir(packages)) {
  const readme = join(packages, packageDir, "README.md");
  try { await stat(readme); } catch { continue; }
  const screenshot = join(packages, packageDir, "assets", "staged-preview.png");
  const text = await readFile(readme, "utf8");
  if (!text.includes("## Staged preview")) errors.push(`${packageDir}: missing Staged preview section`);
  if (!text.includes("assets/staged-preview.png")) errors.push(`${packageDir}: missing screenshot link`);
  try {
    const bytes = await readFile(screenshot);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) errors.push(`${packageDir}: screenshot is not a PNG`);
  } catch { errors.push(`${packageDir}: missing screenshot`); }
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log("Plugin README screenshots: OK");
