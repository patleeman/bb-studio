import { expect, it, vi } from "vitest";
import { ARRANGED_KV_KEY, arrangedRail, arrangeRailOnce, ORDER_KEY, VISIBLE_KEY } from "./rail-arrangement";

it("hides BB's Automations, shows BB's Search, and leaves the rest as it was", () => {
  const next = arrangedRail(["__bb__/new-thread", "__bb__/skills", "github/prs"], null);
  expect(next.visible).toEqual(expect.arrayContaining(["__bb__/new-thread", "__bb__/skills", "github/prs", "__bb__/search-threads"]));
  for (const key of ["__bb__/automations", "automations/automations"]) {
    expect(next.order).toContain(key);
    expect(next.visible).not.toContain(key);
  }
  // A panel the user had hidden stays hidden.
  expect(arrangedRail(["github/prs"], []).visible).not.toContain("github/prs");
});

function deps(arranged: unknown = undefined) {
  const store = new Map<string, unknown>(arranged ? [[ARRANGED_KV_KEY, arranged]] : []);
  const prefs = { [ORDER_KEY]: { value: ["__bb__/automations"], revision: 1 }, [VISIBLE_KEY]: { value: null as string[] | null, revision: 1 } };
  const set = vi.fn(async ({ key, value }: { key: string; value: unknown; expectedRevision: number }) => { (prefs as Record<string, { value: unknown; revision: number }>)[key] = { value, revision: 2 }; });
  return { kv: { get: async (key: string) => store.get(key), set: async (key: string, value: unknown) => { store.set(key, value); } }, list: async () => ({ preferences: prefs }), set, store, prefs };
}

it("arranges the rail once per install, so a panel the user shows again stays shown", async () => {
  const d = deps();
  expect(await arrangeRailOnce(d)).toBe(true);
  expect(d.prefs[VISIBLE_KEY].value).not.toContain("__bb__/automations");
  expect(d.store.get(ARRANGED_KV_KEY)).toBe(true);
  d.set.mockClear();
  expect(await arrangeRailOnce(d)).toBe(false);
  expect(d.set).not.toHaveBeenCalled();
});

it("reads again and retries once when another window changed the rail first", async () => {
  const d = deps();
  d.set.mockRejectedValueOnce(new Error("stale revision"));
  expect(await arrangeRailOnce(d)).toBe(true);
  expect(d.set.mock.calls.filter(([input]) => input.key === VISIBLE_KEY)).toHaveLength(1);
});
