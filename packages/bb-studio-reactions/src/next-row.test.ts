import { describe, expect, it } from "vitest";
import { pagesNextRowOn } from "./next-row";

function sdk(plugins: { id: string; enabled: boolean }[], values: Record<string, unknown> | Error) {
  return {
    plugins: {
      list: async () => ({ plugins }),
      getSettings: async () => {
        if (values instanceof Error) throw values;
        return { values };
      },
    },
  };
}

describe("Pages' Next row", () => {
  it("is on when Pages is enabled and the setting isn't off", async () => {
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true }], {}))).toBe(true);
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true }], { explore_next: true }))).toBe(true);
  });

  it("is off when turned off, when Pages is disabled or missing, or when settings can't be read", async () => {
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true }], { explore_next: false }))).toBe(false);
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: false }], {}))).toBe(false);
    expect(await pagesNextRowOn(sdk([], {}))).toBe(false);
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true }], new Error("nope")))).toBe(false);
  });
});
