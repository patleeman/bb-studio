import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { registerPagesWithExplore } from "./integration";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function seedLegacy(dataDir: string) {
  mkdirSync(join(dataDir, "plugins/explore"), { recursive: true });
  const legacy = new Database(join(dataDir, "plugins/explore/data.db"));
  legacy.exec("CREATE TABLE marker (value TEXT)");
  legacy.prepare("INSERT INTO marker VALUES (?)").run("legacy explainer");
  legacy.close();
  const core = new Database(join(dataDir, "bb.db"));
  core.exec("CREATE TABLE plugin_settings (plugin_id TEXT, key TEXT, value TEXT, updated_at INTEGER)");
  core.prepare("INSERT INTO plugin_settings VALUES ('explore', 'digestHour', '7', 0)").run();
  core.close();
}

async function fixture(options: { enabledLegacy?: boolean; seed?: boolean } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "pages-explore-"));
  if (options.seed) seedLegacy(dataDir);
  const host = createFakePluginHost({ pluginId: "pages", dataDir,
    sdk: { plugins: { list: async () => ({ plugins: options.enabledLegacy === undefined ? [] : [{ id: "explore", enabled: options.enabledLegacy }] }) } } as never });
  cleanups.push(async () => { await host.harness.lifecycle.dispose(); rmSync(dataDir, { recursive: true, force: true }); });
  await registerPagesWithExplore(host.bb, async bb => {
    const settings = bb.settings.define({ snapshotsPerPage: { type: "number", label: "Versions", default: 50 } });
    expect(await settings.get()).toEqual({ snapshotsPerPage: 50 });
    bb.rpc.register({ read: { input: z.null(), output: z.string() } }, { read: () => "page" });
    bb.cli.register({ name: "pages", summary: "Pages", run: () => ({ exitCode: 0, stdout: "pages" }) });
    bb.agents.configure(() => ({ tools: [], skills: [], instructions: "Pages instructions" }));
  });
  return { host, dataDir };
}

it("runs Explore inside Pages with its own database, prefixed RPC and nested CLI", async () => {
  const { host, dataDir } = await fixture();
  expect(await host.harness.behavior.callRpc("exploreStatus", null)).toEqual({ active: true, legacyInstalled: false });
  expect(await host.harness.behavior.callRpc("explore_explainers", {})).toEqual({ explainers: [] });
  expect(await host.harness.behavior.callRpc("read", null)).toBe("page");
  expect(existsSync(join(dataDir, "plugins/pages/explore.db"))).toBe(true);
  expect((await host.harness.registrations.cli!.run(["explore", "list"], {} as never)).exitCode).toBe(0);
  expect((await host.harness.registrations.cli!.run(["list"], {} as never)).stdout).toBe("pages");
});

it("copies a disabled standalone plugin's database and settings once, leaving the original intact", async () => {
  const { dataDir } = await fixture({ enabledLegacy: false, seed: true });
  const copy = new Database(join(dataDir, "plugins/pages/explore.db"), { readonly: true });
  expect(copy.prepare("SELECT value FROM marker").pluck().get()).toBe("legacy explainer");
  copy.close();
  const original = new Database(join(dataDir, "plugins/explore/data.db"), { readonly: true });
  expect(original.prepare("SELECT value FROM marker").pluck().get()).toBe("legacy explainer");
  original.close();
});

it("imports the standalone data into an explore.db Pages made before it had any", async () => {
  const first = await fixture();
  seedLegacy(first.dataDir);
  await first.host.harness.lifecycle.dispose();
  const host = createFakePluginHost({ pluginId: "pages", dataDir: first.dataDir, sdk: { plugins: { list: async () => ({ plugins: [{ id: "explore", enabled: false }] }) } } as never });
  cleanups.push(async () => { await host.harness.lifecycle.dispose(); });
  await registerPagesWithExplore(host.bb, async () => {});
  const copy = new Database(join(first.dataDir, "plugins/pages/explore.db"), { readonly: true });
  expect(copy.prepare("SELECT value FROM marker").pluck().get()).toBe("legacy explainer");
  copy.close();
});

it("stays off while the standalone Explore plugin is enabled", async () => {
  const { host, dataDir } = await fixture({ enabledLegacy: true, seed: true });
  expect(await host.harness.behavior.callRpc("exploreStatus", null)).toEqual({ active: false, legacyInstalled: true });
  expect(existsSync(join(dataDir, "plugins/pages/explore.db"))).toBe(false);
  await expect(host.harness.behavior.callRpc("explore_explainers", {})).rejects.toThrow();
  expect(await host.harness.behavior.callRpc("read", null)).toBe("page");
});
