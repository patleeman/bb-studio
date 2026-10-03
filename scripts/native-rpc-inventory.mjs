import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/** Inventory native wrappers without mistaking them for full payload validation.
 * Repository-owned literal and generated method names must exist in a contract.
 * Dynamic dispatch and external host plugins remain explicitly visible. */
export async function nativeRpcInventory(root, contracts) {
  const local = new Set(JSON.parse(await readFile(join(root, ".bb/plugins.json"), "utf8")).plugins.map(plugin => plugin.name));
  const files = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name === "Generated") continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".swift")) files.push(path);
    }
  }
  for (const folder of ["Shared", "iOS", "Share", "Watch", "Widgets"]) await walk(join(root, "apps/ios", folder));
  const calls = [];
  for (const path of files.sort()) {
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(/\brpc(?:IfPresent)?\(\s*([^,\n]+)\s*,\s*("[^"]+"|[A-Za-z0-9_]+\.Method\.`?[A-Za-z0-9_]+`?|[A-Za-z0-9_]+)/g)) {
      const file = relative(root, path);
      const pluginId = /^"([a-z0-9-]+)"$/.exec(match[1].trim())?.[1];
      const literal = /^"([^"]+)"$/.exec(match[2])?.[1];
      const generated = /^([A-Za-z0-9_]+)\.Method\.`?([A-Za-z0-9_]+)`?$/.exec(match[2]);
      if (!pluginId || (!literal && !generated)) {
        calls.push({ file, plugin: pluginId ?? match[1].trim(), method: match[2], coverage: "dynamic dispatch; runtime validation required" });
        continue;
      }
      const contract = contracts.get(pluginId);
      let method = literal;
      if (generated && contract) {
        if (generated[1] !== contract.namespace) throw new Error(`${file}: ${pluginId} uses the wrong generated namespace ${generated[1]}`);
        method = Object.keys(contract.methods).find(name => name.replace(/[^A-Za-z0-9_]/g, "_") === generated[2]);
      }
      if (local.has(pluginId) && (!contract || !method || !contract.methods[method])) {
        throw new Error(`${file}: native ${pluginId}.${method ?? match[2]} has no matching generated contract`);
      }
      calls.push({ file, plugin: pluginId, method: method ?? match[2], coverage: contract ? generated ? "generated method" : "literal method checked against contract" : "external host plugin; contract maintained outside this repository" });
    }
  }
  return { scope: "Native Swift RPC call sites; method parity only. Handwritten payloads require decoder/transport tests. Dynamic dispatch and external plugins are listed separately.", calls };
}
