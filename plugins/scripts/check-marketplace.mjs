#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const plugins = resolve(import.meta.dirname, "..");
const root = resolve(plugins, "..");
const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const market = await readJson("marketplace.json");
const errors = [];
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schema = await readJson("plugins/scripts/schemas/marketplace.schema.json");
const validate = ajv.compile(schema);
if (!validate(market)) errors.push(...validate.errors.map((error) => `Schema ${error.instancePath || "/"}: ${error.message}`));
const retired = new Set(["plugins/packages/bb-studio-agents"]);
const marketIds = new Set();
const listed = new Set();
for (const entry of market.plugins) {
  if (marketIds.has(entry.id)) errors.push(`Duplicate marketplace ID: ${entry.id}`);
  marketIds.add(entry.id);
  const source = entry.source?.git;
  if (source?.url !== "https://github.com/patleeman/bb-studio.git" || !source?.ref || !source?.subdir) errors.push(`${entry.id}: invalid Git source`);
  if (source?.ref !== "stable") errors.push(`${entry.id}: installs from ${JSON.stringify(source?.ref)}; marketplace entries must use ref "stable"`);
  if (!entry.tags?.includes("bb-studio")) errors.push(`${entry.id}: missing bb-studio tag`);
  const dir = source?.subdir?.replace(/\/$/, "");
  if (!dir) continue;
  listed.add(dir);
  if (!dir.startsWith("plugins/packages/")) errors.push(`${entry.id}: ${dir} is not under plugins/packages/`);
  try {
    const manifest = await readJson(join(dir, "package.json"));
    if (manifest.name?.replace(/^@[^/]+\//, "") !== entry.id) errors.push(`${entry.id}: ID differs from installed ID ${manifest.name}`);
    if (manifest.bb?.name !== entry.displayName || manifest.bb?.description !== entry.description) errors.push(`${entry.id}: display metadata differs from package`);
    if (manifest.bb?.branding?.icon !== (typeof entry.icon === "string" ? entry.icon : `./${relative(dir, entry.icon.url.replace(/^\.\//, ""))}`)) errors.push(`${entry.id}: icon differs from package`);
  } catch { errors.push(`${entry.id}: missing package directory or manifest`); }
  if (typeof entry.icon === "object") {
    try { await stat(join(root, entry.icon.url)); } catch { errors.push(`${entry.id}: missing icon asset`); }
  }
}
for (const name of await readdir(join(plugins, "packages"))) {
  const path = `plugins/packages/${name}`;
  let manifest;
  try { manifest = await readJson(join(path, "package.json")); } catch { continue; }
  if (manifest.bb?.name && !listed.has(path) && !retired.has(path)) errors.push(`${path}: plugin absent from marketplace.json`);
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Marketplace: ${marketIds.size} matching plugins`);
