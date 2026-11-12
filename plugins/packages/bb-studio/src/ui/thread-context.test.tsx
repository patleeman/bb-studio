import { expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ cardRow: true }));
vi.mock("./bot/BotCache", () => ({ BotCacheDetails: () => null, BotCacheSummary: () => null, cacheLabel: () => "", costLine: () => null, registerCacheCardRow: () => host.cardRow }));
vi.mock("./bot/cache-footer", () => ({ BotCacheFooter: () => null, useCacheFooter: () => ({ active: false }) }));
vi.mock("./automations/ThreadAutomations", () => ({ ThreadAutomationsSummary: () => null, useThreadAutomationsVisible: () => false }));
vi.mock("./live", () => ({ useLive: () => ({ data: null }) }));
vi.mock("./bot/BotTabs", () => ({ BotInfoSection: () => null }));
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({ ...(await original<object>()), experimental_DetailRow: () => null }));

import { registerThreadContext } from "./thread-context";

function register() {
  const segments: string[] = [];
  const rows: { id: string; group: string }[] = [];
  const customizations: { id: string; experimental_footer?: unknown[] }[] = [];
  registerThreadContext({
    slots: { experimental_threadContextSegment: (segment: { id: string }) => segments.push(segment.id), experimental_threadInfoRow: (row: { id: string; group: string }) => rows.push(row) },
    composer: { customize: (customization: { id: string }) => customizations.push(customization) },
  } as never);
  return { segments, customizations, rows };
}

it("puts the cache chip only in the composer's footer where BB has the fork's footer and context card", () => {
  host.cardRow = true;
  const { segments, customizations } = register();
  expect(segments).not.toContain("bot-cache");
  expect(customizations.find((each) => each.id === "bot-cache-footer")?.experimental_footer).toHaveLength(1);
});

it("keeps the chip in the context row above the composer on a BB without them", () => {
  host.cardRow = false;
  const { segments, customizations } = register();
  expect(segments).toContain("bot-cache");
  expect(customizations.some((each) => each.id === "bot-cache-footer")).toBe(false);
});

it("puts the Bot's section at the top of BB's Info tab: its row group sorts before every BB group", () => {
  const { rows } = register();
  const section = rows.find((row) => row.id === "bot-space")!;
  expect(section.group).toBe("0_bot");
  for (const group of ["1_thread", "2_environment", "3_git", "4_pullRequest", "5_lifecycle"]) expect(section.group < group).toBe(true);
});
