import { describe, expect, it, vi } from "vitest";
import { arrangeFooterOnce, arrangedFooter, FOOTER_ARRANGED_KV_KEY, HIDDEN_FOOTER_KEY } from "./footer-arrangement";

function deps(hidden: string[], done = false) {
  const kv = new Map<string, unknown>(done ? [[FOOTER_ARRANGED_KV_KEY, true]] : []);
  let revision = 3;
  let value = hidden;
  const set = vi.fn(async (input: { key: string; value: unknown; expectedRevision: number }) => {
    if (input.expectedRevision !== revision) throw new Error("conflict");
    value = input.value as string[];
    revision += 1;
  });
  return {
    kv: { get: async (key: string) => kv.get(key), set: async (key: string, next: unknown) => { kv.set(key, next); } },
    list: async () => ({ preferences: { [HIDDEN_FOOTER_KEY]: { value, revision } } }),
    set,
    value: () => value,
    bump: () => { revision += 1; },
  };
}

describe("footer arrangement", () => {
  it("moves bb's Mobile, Report a bug and usage items and Studio's Accounts, Plugin health and Report a bug into More, keeping the user's own", () => {
    expect(arrangedFooter(["plugin:x/y", "builtin:mobile"])).toEqual(["plugin:x/y", "builtin:mobile", "builtin:report-bug", "plugin:bb--provider-usage/usage", "plugin:studio/accounts", "plugin:studio/health", "plugin:studio/report-bug"]);
  });

  it("runs once per install, so an item the user puts back stays", async () => {
    const store = deps(["plugin:x/y"]);
    await expect(arrangeFooterOnce(store)).resolves.toBe(true);
    expect(store.value()).toContain("plugin:studio/accounts");
    expect(store.value()).not.toContain("plugin:studio/theme");
    await expect(arrangeFooterOnce(store)).resolves.toBe(false);
    expect(store.set).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a later run", async () => {
    const store = deps([], true);
    await expect(arrangeFooterOnce(store)).resolves.toBe(false);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("reads again once when another client changed the list", async () => {
    const store = deps([]);
    const set = store.set.getMockImplementation()!;
    let first = true;
    store.set.mockImplementation(async (input) => {
      if (first) { first = false; store.bump(); throw new Error("conflict"); }
      return set(input);
    });
    await expect(arrangeFooterOnce(store)).resolves.toBe(true);
    expect(store.set).toHaveBeenCalledTimes(2);
  });
});
