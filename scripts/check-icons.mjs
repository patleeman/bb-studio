// Every icon a plugin names must be one BB draws: an unknown name silently
// renders a fallback glyph. Checks literal icon names in the plugins' sources
// against BB's built-in set (scripts/bb-icons.json, copied from BB's
// shared-ui icon maps), the `<plugin>/<name>` icons plugins ship in
// bb.branding.experimental_icons, and icons registered in code.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const builtin = new Set(JSON.parse(readFileSync(join(root, "scripts/bb-icons.json"), "utf8")).names);
const packages = join(root, "packages");
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", "dist.prev", "upstream", "test", "testing"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
  }
};
const namespaced = new Set();
for (const dir of readdirSync(packages)) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(packages, dir, "package.json"), "utf8")); } catch { continue; }
  const id = manifest.name?.replace(/^@bb-studio\//, "");
  for (const key of Object.keys(manifest.bb?.branding?.experimental_icons ?? {})) namespaced.add(`${id}/${key}`);
  walk(join(packages, dir));
}
const registered = new Set();
for (const file of files) for (const [, name] of readFileSync(file, "utf8").matchAll(/\{\s*name:\s*"([A-Za-z0-9]+)",\s*component:/g)) registered.add(name);

const ICON = /\b(?:name|icon|kindIcon|fallback)(?:=|:\s*)"([A-Za-z][\w/-]*)"/g;
const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!/Icon|icon/.test(text)) continue;
  text.split("\n").forEach((line, index) => {
    if (!/Icon|icon/i.test(line)) return;
    for (const [, name] of line.matchAll(ICON)) {
      // Only names that look like icons: capitalised, or plugin/name.
      if (!/^[A-Z]/.test(name) && !name.includes("/")) continue;
      // An icon's `name` sits on an Icon element or an icon field; skip other `name:` strings.
      if (/\bname[=:]/.test(line) && !/<Icon\b|<KitIcon\b|icon/i.test(line.slice(0, line.indexOf(name)))) continue;
      const ok = name.includes("/") ? namespaced.has(name) : builtin.has(name) || registered.has(name);
      if (!ok) problems.push(`${relative(root, file)}:${index + 1}: ${name}`);
    }
  });
}
if (problems.length) {
  console.error(`Icons BB doesn't have (they render a fallback glyph):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`Icons: checked ${files.length} files.`);
