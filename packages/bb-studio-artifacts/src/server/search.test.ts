import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import plugin from "../../server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

it("artifacts_list and @artifact search find older artifacts past the newest few hundred", async () => {
  let now = 1_000;
  const realNow = Date.now;
  Date.now = () => now++;
  try {
    const host = createFakePluginHost({ pluginId: "artifacts" });
    hosts.push(host);
    await plugin(host.bb);
    const save = (name: string) => host.harness.behavior.callRpc("importFile", { name, mime: "text/plain", bytes: Buffer.from(name).toString("base64"), projectId: null });
    await save("needle-old.txt");
    for (let index = 0; index < 501; index++) await save(`filler-${index}.txt`);

    const listed = await host.harness.behavior.callAgentTool("artifacts_list", { query: "needle" });
    expect(JSON.stringify(listed)).toContain("Needle old");

    const provider = host.harness.registrations.mentionProviders.find((each: { id: string }) => each.id === "artifact") as unknown as {
      search(input: { query: string }): Promise<{ title: string }[]> | { title: string }[];
    };
    const found = await provider.search({ query: "needle" });
    expect(JSON.stringify(found)).toContain("Needle old");
  } finally {
    Date.now = realNow;
  }
});
