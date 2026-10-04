import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import { interactionSource } from "./interaction-source";

it("lists offered decisions and rechecks live status before responding", async () => {
  let pending = true;
  const interaction = () => ({ id: "i1", status: pending ? "pending" : "resolved", createdAt: 42,
    payload: { kind: "approval", reason: "Write outside home", availableDecisions: ["deny"] } });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: async () => [{ ...makeThreadResponse({ id: "t1", projectId: "work" }), hasPendingInteraction: true }],
      interactions: {
        list: async () => [interaction()] as never,
        get: async () => interaction() as never,
        respond: async () => { pending = false; return {} as never; },
      },
    },
  } });
  const source = interactionSource(bb.sdk);
  const rows = await source.list();
  expect(rows[0]).toMatchObject({ key: "interaction:i1", projectId: "work", createdAt: 42, actions: [{ id: "deny", label: "Deny" }] });
  await expect(source.act(rows[0]!, "approve")).rejects.toThrow("Open the thread");
  await source.act(rows[0]!, "deny");
  await expect(source.act(rows[0]!, "deny")).rejects.toThrow("already been answered");
  expect(await source.list()).toEqual([]);
  await harness.lifecycle.dispose();
});
