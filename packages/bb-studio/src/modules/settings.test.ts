import Database from "better-sqlite3";
import { expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { moduleSettings } from "./settings";

it("imports namespaced preferences once and preserves later host edits and unset defaults", async () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE studio_module_state (kind TEXT, key TEXT, value TEXT)");
  db.prepare("INSERT INTO studio_module_state VALUES ('settings', 'notify', ?)").run(JSON.stringify("off"));
  const saved: Record<string, unknown> = {};
  const host: BbPluginApi["settings"] = { define(descriptors) {
    const values = () => Object.fromEntries(Object.entries(descriptors).map(([key, field]) => [key, saved[key] ?? field.default])) as never;
    return { get: async () => values(), experimental_set: async next => {
      for (const [key, value] of Object.entries(next)) { if (value === null) delete saved[key]; else saved[key] = value; }
      return values();
    }, onChange: () => {} };
  } };
  const definition = { notify: { type: "select", label: "Notify", options: ["urgent", "off"], default: "urgent" } } as const;
  const create = () => moduleSettings(host, db, "feed").define({ notify: { ...definition.notify, options: [...definition.notify.options] } });
  const initial = create();
  expect(await initial.get()).toEqual({ notify: "off" });
  expect(saved).toEqual({ feed_notify: "off" });
  await initial.experimental_set({ notify: "urgent" });
  expect(await create().get()).toEqual({ notify: "urgent" });
  await initial.experimental_set({ notify: null });
  expect(await create().get()).toEqual({ notify: "urgent" });
  expect(db.prepare("SELECT value FROM studio_module_state").get()).toEqual({ value: '"off"' });
  db.close();
});

it("moves legacy secrets directly into host settings once without a database copy", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "studio-secrets-test-"));
  const db = new Database(":memory:");
  db.exec("CREATE TABLE studio_module_state (kind TEXT, key TEXT, value TEXT)");
  const saved: Record<string, unknown> = {};
  const host: BbPluginApi["settings"] = { define() { return {
    get: async () => saved as never,
    experimental_set: async values => { Object.assign(saved, values); return saved as never; }, onChange() {},
  }; } };
  try {
    writeFileSync(join(directory, "apiKey"), "synthetic-test-key", { mode: 0o600 });
    const create = () => moduleSettings(host, db, "decisions", directory).define({ apiKey: { type: "string", label: "Key", secret: true } });
    expect(await create().get()).toEqual({ apiKey: "synthetic-test-key" });
    expect(db.prepare("SELECT * FROM studio_module_state").all()).toEqual([]);
    saved.decisions_apiKey = "changed-by-user";
    expect(await create().get()).toEqual({ apiKey: "changed-by-user" });
    saved.decisions_apiKey = undefined;
    expect(await create().get()).toEqual({ apiKey: undefined });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
