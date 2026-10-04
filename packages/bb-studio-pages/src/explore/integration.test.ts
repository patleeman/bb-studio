import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { registerPagesWithExplore } from "./integration";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "pages-explore-"));
  const host = createFakePluginHost({ pluginId: "pages", dataDir });
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
  expect(await host.harness.behavior.callRpc("explore_explainers", {})).toEqual({ explainers: [] });
  expect(await host.harness.behavior.callRpc("read", null)).toBe("page");
  expect(existsSync(join(dataDir, "plugins/pages/explore.db"))).toBe(true);
  expect((await host.harness.registrations.cli!.run(["explore", "list"], {} as never)).exitCode).toBe(0);
  expect((await host.harness.registrations.cli!.run(["list"], {} as never)).stdout).toBe("pages");
});
