import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import plugin from "../../server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

it("bb artifacts list --thread outside a thread refuses instead of listing everything", async () => {
  const host = createFakePluginHost({ pluginId: "artifacts" });
  hosts.push(host);
  await plugin(host.bb);
  await host.harness.behavior.callRpc("importFile", { name: "elsewhere.txt", mime: "text/plain", bytes: Buffer.from("x").toString("base64"), projectId: null });
  const result = await host.harness.behavior.runCli(["list", "--thread"], {} as never);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).not.toContain("Elsewhere");
});

it("artifacts_save refuses inline content named . or ..", async () => {
  const host = createFakePluginHost({ pluginId: "artifacts" });
  hosts.push(host);
  await plugin(host.bb);
  for (const name of ["..", "notes/..", "."]) {
    const result = await host.harness.behavior.callAgentTool("artifacts_save", { content: "x", name, title: "Dots" });
    expect(result).toMatchObject({ isError: true });
  }
  expect((await host.harness.behavior.runCli(["list"], {} as never)).stdout).toBe("No artifacts yet.\n");
});
