import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { BbPluginApi, PluginSettingDescriptor } from "@get-bb/plugin-sdk";

/** Namespaced host settings retain BB's settings UI and change notifications. */
export function moduleSettings(host: BbPluginApi["settings"], db: Database.Database, module: string, legacySecretsDirectory?: string): BbPluginApi["settings"] {
  db.exec("CREATE TABLE IF NOT EXISTS studio_module_settings_imports (key TEXT PRIMARY KEY)");
  return { define(descriptors) {
    const prefix = `${module}_`;
    const mapped: Record<string, PluginSettingDescriptor> = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [prefix + key, { ...descriptor, label: `${module}: ${descriptor.label}` }]));
    const handle = host.define(mapped);
    const keys = Object.keys(descriptors);
    const project = (values: Record<string, unknown>) => Object.fromEntries(keys.map(key => [key, values[prefix + key]])) as never;
    // A field's first appearance imports its saved value once. Later reloads
    // and unset operations use the host's regular defaults and persistence.
    const imported = keys.flatMap(key => {
      if (db.prepare("SELECT 1 FROM studio_module_settings_imports WHERE key = ?").get(key)) return [];
      const descriptor = descriptors[key];
      if (descriptor.type === "string" && descriptor.secret && legacySecretsDirectory) {
        // Secret values go directly into the host's protected secret store,
        // never through the module import database or a log.
        if (!/^[A-Za-z0-9_.-]+$/.test(key) || key === "." || key === "..") throw new Error("Invalid module secret key");
        try { return [{ key, value: readFileSync(join(legacySecretsDirectory, key), "utf8") }]; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return []; }
      }
      const row = db.prepare("SELECT value FROM studio_module_state WHERE kind = 'settings' AND key = ?").get(key) as { value: string } | undefined;
      return row ? [{ key, value: JSON.parse(row.value) }] : [];
    });
    const ready = imported.length ? handle.experimental_set(Object.fromEntries(imported.map(({ key, value }) => [prefix + key, value]))).then(() => {
      db.transaction(() => { for (const { key } of imported) db.prepare("INSERT INTO studio_module_settings_imports VALUES (?)").run(key); })();
    }) : Promise.resolve();
    return {
      async get() { await ready; return project(await handle.get()); },
      async experimental_set(values) { await ready; return project(await handle.experimental_set(Object.fromEntries(Object.entries(values).map(([key, value]) => [prefix + key, value])))); },
      onChange(listener) { handle.onChange((next, prev) => listener(project(next), project(prev))); },
    };
  } };
}
