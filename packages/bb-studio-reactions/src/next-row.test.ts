import { describe, expect, it } from "vitest";
import { pagesNextRowOn, trackPagesNextRow } from "./next-row";

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

describe("tracking Pages' Next row", () => {
  it("returns at once, off, while BB hasn't answered yet", () => {
    const hung = { plugins: { list: () => new Promise<never>(() => {}), getSettings: async () => ({ schema: NEXT_SCHEMA, values: {} }) } };
    const tracker = trackPagesNextRow(hung, 60_000);
    expect(tracker.on()).toBe(false);
    tracker.dispose();
  });

  it("rechecks as soon as BB reports a system change, not a minute later", async () => {
    let values: Record<string, unknown> = { explore_next: true };
    let emit: (event: unknown) => void = () => {};
    const live = {
      plugins: {
        list: async () => ({ plugins: [{ id: "pages", enabled: true, status: "running" }] }),
        getSettings: async () => ({ schema: NEXT_SCHEMA, values }),
      },
      subscribe: ({ callback }: { event: "system:changed"; callback: (event: unknown) => void }) => {
        emit = callback;
        return () => { emit = () => {}; };
      },
    };
    const tracker = trackPagesNextRow(live, 50);
    expect(await tracker.refresh()).toBe(true);
    values = { explore_next: false };
    emit({ entity: "system", type: "changed", changes: ["plugins-changed"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tracker.on()).toBe(false);
    values = { explore_next: true };
    expect(await tracker.refresh()).toBe(true);
    tracker.dispose();
  });

  it("keeps the newest answer when checks finish out of order", async () => {
    const answers: ((value: { schema: typeof NEXT_SCHEMA; values: Record<string, unknown> }) => void)[] = [];
    let first = true;
    const slow = {
      plugins: {
        list: async () => ({ plugins: [{ id: "pages", enabled: true }] }),
        getSettings: () => first
          ? (first = false, Promise.resolve({ schema: NEXT_SCHEMA, values: { explore_next: true } }))
          : new Promise<{ schema: typeof NEXT_SCHEMA; values: Record<string, unknown> }>((resolve) => answers.push(resolve)),
      },
    };
    const tracker = trackPagesNextRow(slow, 1_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const older = tracker.refresh();
    const newer = tracker.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    answers[1]({ schema: NEXT_SCHEMA, values: { explore_next: false } });
    await newer;
    answers[0]({ schema: NEXT_SCHEMA, values: { explore_next: true } });
    await older;
    expect(tracker.on()).toBe(false);
    tracker.dispose();
  });
});
