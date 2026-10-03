import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { registerPagesWithExplore } from "./integration";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(enabledLegacy = false) {
  const dataDir = mkdtempSync(join(tmpdir(), "pages-explore-"));
  const host = createFakePluginHost({ pluginId: "pages", dataDir,
    sdk: { plugins: { list: async () => ({ plugins: enabledLegacy ? [{ id: "explore", enabled: true }] : [] }) } } });
  cleanups.push(async () => { await host.harness.lifecycle.dispose(); rmSync(dataDir, { recursive: true, force: true }); });
  await registerPagesWithExplore(host.bb, async bb => {
    bb.rpc.register({ read: { input: z.null(), output: z.string() } }, { read: () => "page" });
    bb.cli.register({ name: "pages", summary: "Pages", run: () => ({ exitCode: 0, stdout: "pages" }) });
    bb.agents.configure(() => ({ tools: [], skills: [], instructions: "Pages instructions" }));
  });
  return { host, dataDir };
}

it("registers Explore under Pages with a separate database and nested CLI", async () => {
  const { host, dataDir } = await fixture();
  expect(await host.harness.behavior.callRpc("exploreStatus", null)).toEqual({ active: true, legacyInstalled: false });
  expect(await host.harness.behavior.callRpc("explore_explainers", {})).toEqual({ explainers: [] });
  expect(await host.harness.behavior.callRpc("read", null)).toBe("page");
  expect(existsSync(join(dataDir, "plugins/pages/explore.db"))).toBe(true);
  expect(existsSync(join(dataDir, "plugins/studio/explore.db"))).toBe(false);
  expect((await host.harness.registrations.cli!.run(["explore", "list"], {})).exitCode).toBe(0);
  expect((await host.harness.registrations.cli!.run(["list"], {})).stdout).toBe("pages");
});

it("leaves the enabled legacy writer in charge without importing or registering its RPCs", async () => {
  const { host, dataDir } = await fixture(true);
  expect(await host.harness.behavior.callRpc("exploreStatus", null)).toEqual({ active: false, legacyInstalled: true });
  expect(existsSync(join(dataDir, "plugins/pages/explore.db"))).toBe(false);
  await expect(host.harness.behavior.callRpc("explore_explainers", {})).rejects.toThrow();
});
