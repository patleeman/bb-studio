import { afterEach, describe, expect, it, vi } from "vitest";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { openUrlWithPlugin } from "./fork-link-handlers";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "./plugin-slots";

afterEach(() => {
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("plugin link handlers", () => {
  it("lets the first plugin that takes the link open it, in plugin-id order", () => {
    const seen: string[] = [];
    setPluginSlotRegistrations(
      "zeta",
      makePluginRegistrationSet({
        linkHandlers: [
          {
            id: "all",
            handle: (url) => {
              seen.push(`zeta:${url}`);
              return true;
            },
          },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        linkHandlers: [
          {
            id: "pages",
            handle: (url) => {
              seen.push(`alpha:${url}`);
              return url.includes("/pages/");
            },
          },
        ],
      }),
    );

    expect(openUrlWithPlugin("https://x.test/pages/1")).toBe(true);
    expect(openUrlWithPlugin("https://x.test/other")).toBe(true);
    expect(seen).toEqual([
      "alpha:https://x.test/pages/1",
      "alpha:https://x.test/other",
      "zeta:https://x.test/other",
    ]);
  });

  it("leaves the link to bb when no plugin takes it or a handler throws", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(openUrlWithPlugin("https://x.test/")).toBe(false);
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        linkHandlers: [
          {
            id: "broken",
            handle: () => {
              throw new Error("boom");
            },
          },
        ],
      }),
    );
    expect(openUrlWithPlugin("https://x.test/")).toBe(false);
  });
});
