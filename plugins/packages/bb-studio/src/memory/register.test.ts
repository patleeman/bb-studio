import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import { RECORDS_RETIRED, registerMemory } from "./register";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

function host(skills: { name: string; body: string; updatedAt: number }[]) {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  dispose.push(() => harness.lifecycle.dispose());
  registerMemory(bb, {
    bot: (botId) => { if (botId && botId !== "bot_main") throw new Error(`No Bot "${botId}".`); return { id: "bot_main", name: "Dot" }; },
    alwaysOn: () => skills,
    budget: () => { const chars = skills.reduce((sum, skill) => sum + skill.body.trim().length, 0); return { chars, cap: 3000, over: chars > 3000 }; },
    oldPage: () => null,
  });
  return harness;
}

it("keeps the phone's Memory page working: the always-on skills as its core profile, no records", async () => {
  const harness = host([{ name: "core-profile", body: "## Preferences\n\n- Short answers.\n", updatedAt: 5 }]);
  expect(await harness.callRpc("memory.overview", {} as never)).toEqual({
    bot: { id: "bot_main", name: "Dot" },
    profile: { pageId: "", title: "Always on", updatedAt: 5, chars: 32, cap: 3000, over: false },
    split: { state: "none", legacyPageId: null, legacyTitle: null, splitAt: null },
    counts: { current: 0, replaced: 0, archived: 0 },
    topics: [],
  });
  expect(await harness.callRpc("memory.profile", { botId: "bot_main" } as never)).toMatchObject({ profile: { markdown: "## Preferences\n\n- Short answers." } });
  expect(await harness.callRpc("memory.list", { query: "anything" } as never)).toEqual({ records: [], total: 0 });
  expect(await harness.callRpc("memory.get", { id: "mem_1" } as never)).toEqual({ record: null });
});

it("refuses new or changed records, saying where things go now", async () => {
  const harness = host([]);
  await expect(harness.callRpc("memory.add", { topic: "T", text: "A fact." } as never)).rejects.toThrow(RECORDS_RETIRED);
  await expect(harness.callRpc("memory.update", { id: "mem_1", text: "x" } as never)).rejects.toThrow(/retired/);
  await expect(harness.callRpc("memory.archive", { id: "mem_1", archived: true } as never)).rejects.toThrow(/retired/);
  expect(await harness.callRpc("memory.overview", {} as never)).toMatchObject({ profile: null });
});
