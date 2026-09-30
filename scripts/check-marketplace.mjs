#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const market = await readJson("marketplace.json");
const installed = await readJson(".bb/plugins.json");
const errors = [];
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schema = await readJson("scripts/schemas/marketplace.schema.json");
const validate = ajv.compile(schema);
if (!validate(market)) errors.push(...validate.errors.map((error) => `Schema ${error.instancePath || "/"}: ${error.message}`));
const index = new Map(installed.plugins.map((plugin) => [plugin.name, plugin]));
const marketIds = new Set();
for (const entry of market.plugins) {
  if (marketIds.has(entry.id)) errors.push(`Duplicate marketplace ID: ${entry.id}`);
  marketIds.add(entry.id);
  const plugin = index.get(entry.id);
  if (!plugin) errors.push(`${entry.id}: absent from .bb/plugins.json`);
  const source = entry.source?.git;
  if (source?.url !== "https://github.com/patleeman/bb-studio.git" || !source?.ref || !source?.subdir) errors.push(`${entry.id}: invalid Git source`);
  if (plugin && source?.subdir !== plugin.source.replace(/^\.\//, "")) errors.push(`${entry.id}: source paths differ`);
  if (!entry.tags?.includes("bb-studio")) errors.push(`${entry.id}: missing bb-studio tag`);
  const dir = source?.subdir;
  if (!dir) continue;
  try {
    const manifest = await readJson(join(dir, "package.json"));
    if (manifest.bb?.name !== entry.displayName || manifest.bb?.description !== entry.description) errors.push(`${entry.id}: display metadata differs from package`);
    if (manifest.bb?.branding?.icon !== (typeof entry.icon === "string" ? entry.icon : `./${relative(dir, entry.icon.url.replace(/^\.\//, ""))}`)) errors.push(`${entry.id}: icon differs from package`);
  } catch { errors.push(`${entry.id}: missing package directory or manifest`); }
  if (typeof entry.icon === "object") {
    try { await stat(join(root, entry.icon.url)); } catch { errors.push(`${entry.id}: missing icon asset`); }
  }
}
for (const plugin of installed.plugins) {
  if (!marketIds.has(plugin.name)) errors.push(`${plugin.name}: absent from marketplace.json`);
  if (index.get(plugin.name) !== plugin) errors.push(`Duplicate installed ID: ${plugin.name}`);
  try { await stat(join(root, plugin.source)); } catch { errors.push(`${plugin.name}: missing package directory`); }
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Marketplace: ${marketIds.size} matching plugins`);
