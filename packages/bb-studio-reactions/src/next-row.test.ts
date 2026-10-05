import { describe, expect, it } from "vitest";
import { pagesNextRowOn } from "./next-row";

const NEXT_SCHEMA = { explore_next: { type: "boolean", label: "Next row", default: true } };

function sdk(
  plugins: { id: string; enabled: boolean; status?: string }[],
  values: Record<string, unknown> | Error,
  schema: Record<string, unknown> = NEXT_SCHEMA,
) {
  return {
    plugins: {
      list: async () => ({ plugins }),
      getSettings: async () => {
        if (values instanceof Error) throw values;
        return { schema, values };
      },
    },
  };
}

describe("Pages' Next row", () => {
  it("is on when Pages is enabled and the setting isn't off", async () => {
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true }], {}))).toBe(true);
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true }], { explore_next: true }))).toBe(true);
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true, status: "running" }], { explore_next: true }))).toBe(true);
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true, status: "starting" }], { explore_next: true }))).toBe(true);
  });

  it("is off when turned off, when Pages is disabled or missing, or when settings can't be read", async () => {
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true }], { explore_next: false }))).toBe(false);
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: false }], {}))).toBe(false);
    expect(await pagesNextRowOn(sdk([], {}))).toBe(false);
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true }], new Error("nope")))).toBe(false);
  });

  it("is off when Pages is too old to have a Next row", async () => {
    expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true, status: "running" }], { explore_explore: true }, { explore_explore: {} }))).toBe(false);
  });

  it("is off when Pages is enabled but failed to load", async () => {
    for (const status of ["error", "incompatible", "missing", "needs-configuration"]) {
      expect(await pagesNextRowOn(sdk([{ id: "pages", enabled: true, status }], { explore_next: true }))).toBe(false);
    }
  });

  it("is off when BB doesn't answer in time", async () => {
    const hung = { plugins: { list: () => new Promise<never>(() => {}), getSettings: async () => ({ schema: NEXT_SCHEMA, values: {} }) } };
    expect(await pagesNextRowOn(hung, 20)).toBe(false);
  });
});
