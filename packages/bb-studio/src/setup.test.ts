import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { HealthSummary, Problem } from "./health-contract";
import { buildSetup, classify, formatSetup, oneLine, RETIRED, SetupService, type SetupPluginEntry, type SetupSdk } from "./setup";
import { ADDONS, MARKETPLACE_NAME } from "./setup-addons";

const plugin = (id: string, extra: Partial<SetupPluginEntry> = {}): SetupPluginEntry => ({ id, name: id, enabled: true, status: "running", version: "1.0.0", ...extra });
const problem = (pluginId: string, status: Problem["status"], title = "Add a key"): Problem => ({
  key: `${pluginId}:${title}`, pluginId, pluginName: pluginId, status, title, detail: null, fix: { label: "Open settings", path: `/settings/plugins/${pluginId}` }, hidden: false, lasting: true,
});
const health = (extra: Partial<HealthSummary> = {}): HealthSummary => ({ checkedAt: 1000, problems: [], healthy: [], unanswered: [], ...extra });

function fakeSdk(plugins: SetupPluginEntry[], opts: { marketplaces?: string[]; installFails?: string[] } = {}) {
  const calls: string[] = [];
  const sdk = {
    plugins: {
      list: async () => ({ plugins }),
      enable: vi.fn(async ({ pluginId }: { pluginId: string }) => { calls.push(`enable ${pluginId}`); }),
      remove: vi.fn(async ({ pluginId }: { pluginId: string }) => { calls.push(`remove ${pluginId}`); }),
      callRpc: vi.fn(async ({ pluginId, method }: { pluginId: string; method: string }) => {
        calls.push(`rpc ${pluginId} ${method}`);
        return { item: null };
      }),
      catalog: {
        installPlan: vi.fn(async ({ entryId }: { entryId: string }) => ({ kind: "marketplace", compatible: true, incompatibleReason: null, resolvedSource: { kind: "git", url: "https://github.com/patleeman/bb-studio.git", subdir: `packages/${entryId}` } })),
        install: vi.fn(async ({ entryId, marketplace, confirmedSource }: { entryId: string; marketplace?: string; confirmedSource?: unknown }) => {
          if (opts.installFails?.includes(entryId)) throw new Error("permission denied");
          calls.push(`install ${entryId}@${marketplace} ${confirmedSource ? "confirmed" : "unconfirmed"}`);
        }),
      },
      marketplaces: { list: async () => (opts.marketplaces ?? [MARKETPLACE_NAME]).map((name) => ({ name })) },
    },
  };
  return { sdk: sdk as unknown as SetupSdk, raw: sdk, calls };
}

const allInstalled = () => ADDONS.map((addOn) => plugin(addOn.id));

describe("add-on list", () => {
  it("matches marketplace.json", () => {
    const marketplace = JSON.parse(readFileSync(new URL("../../../marketplace.json", import.meta.url), "utf8")) as { name: string; plugins: { id: string; displayName: string; description: string }[] };
    expect(marketplace.name).toBe(MARKETPLACE_NAME);
    const retired = new Set(RETIRED.map((plugin) => plugin.id));
    expect(ADDONS).toEqual(marketplace.plugins.filter(({ id }) => !retired.has(id)).map(({ id, displayName, description }) => ({ id, displayName, description })));
  });

  it("shortens descriptions to one line", () => {
    expect(oneLine("Part of BB Studio. Collaborative pages, with comments. More here.")).toBe("Collaborative pages, with comments.");
    expect(oneLine("No full stop")).toBe("No full stop");
  });
});

describe("classify", () => {
  it("puts BB's status and health problems in one status", () => {
    expect(classify(undefined, [])).toBe("not-installed");
    expect(classify(plugin("a", { enabled: false }), [problem("a", "broken")])).toBe("disabled");
    expect(classify(plugin("a"), [problem("a", "degraded"), problem("a", "broken")])).toBe("broken");
    expect(classify(plugin("a"), [problem("a", "degraded")])).toBe("needs-setup");
    expect(classify(plugin("a"), [])).toBe("installed");
  });
});

describe("buildSetup", () => {
  it("lists every add-on with its status, checks and the commands left", async () => {
    const plugins = allInstalled().filter((each) => each.id !== "mobile").map((each) => (each.id === "studio" ? { ...each, enabled: false } : each));
    const { sdk } = fakeSdk([...plugins, plugin("other")]);
    const summary = await buildSetup(sdk, health({
      problems: [problem("studio-code", "degraded", "Editor needs setup"), problem("other", "broken", "Stopped")],
      healthy: [{ pluginId: "studio-code", pluginName: "Studio Code", titles: ["code-server found"] }],
    }));
    const byId = Object.fromEntries(summary.addOns.map((addOn) => [addOn.id, addOn]));
    expect(byId.mobile).toMatchObject({ status: "not-installed", optional: expect.stringContaining("iOS") });
    expect(byId.studio).toMatchObject({ status: "disabled", command: "bb plugin enable studio" });
    expect(byId["smart-decisions"]).toBeUndefined();
    expect(byId["studio-code"]!.problems.map((each) => each.title)).toEqual(["Editor needs setup"]);
    expect(byId["studio-code"]).toMatchObject({ status: "needs-setup", passed: [] });
    expect(summary.commands).toEqual(["bb plugin enable studio"]);
    expect(summary.installAll).toBeNull();
    expect(summary.otherProblems.map((each) => each.pluginId)).toEqual(["other"]);
    expect(summary.checkedAt).toBe(1000);
  });

  it("asks to add the marketplace before installing from it", async () => {
    const { sdk } = fakeSdk([plugin("studio")], { marketplaces: ["bb-community"] });
    const summary = await buildSetup(sdk, health());
    expect(summary.marketplaceAdded).toBe(false);
    expect(summary.commands[0]).toBe("bb marketplace add git:github.com/patleeman/bb-studio@main");
    expect(summary.installAll?.split(" && ")).toHaveLength(ADDONS.length - 2);
  });
});

describe("retired plugins", () => {
  it("lists only the installed ones, with what's kept and deleted", async () => {
    const { sdk } = fakeSdk([...allInstalled(), plugin("studio-tables", { enabled: false }), plugin("pages")]);
    const summary = await buildSetup(sdk, health());
    expect(summary.retired.map((each) => each.id)).toEqual(["studio-tables"]);
    expect(summary.retired[0]).toMatchObject({ blocker: null, removeCommand: "bb plugin remove studio-tables", kept: expect.any(String), deleted: expect.stringContaining("CSV"), enabled: false });
  });
});

describe("SetupService", () => {
  const service = (fake: ReturnType<typeof fakeSdk>) => new SetupService({ sdk: fake.sdk, health: async () => health() });

  it("installs from the bb-studio marketplace with the source BB resolved, and reports failures", async () => {
    const fake = fakeSdk([plugin("studio")], { installFails: ["studio-code"] });
    const result = await service(fake).install(["mobile", "studio-code"]);
    expect(fake.calls).toEqual(["install mobile@bb-studio confirmed"]);
    expect(result.failures).toEqual([{ id: "studio-code", error: "permission denied" }]);
    await expect(service(fake).install(["not-ours"])).resolves.toMatchObject({ failures: [{ id: "not-ours", error: expect.stringContaining("isn't a BB Studio add-on") }] });
  });

  it("refuses an incompatible add-on", async () => {
    const fake = fakeSdk([]);
    fake.raw.plugins.catalog.installPlan.mockResolvedValueOnce({ kind: "marketplace", compatible: false, incompatibleReason: "Needs BB 0.50" as never, resolvedSource: {} as never });
    const result = await service(fake).install(["mobile"]);
    expect(result.failures).toEqual([{ id: "mobile", error: "Needs BB 0.50" }]);
    expect(fake.raw.plugins.catalog.install).not.toHaveBeenCalled();
  });

  it("enables only add-ons and removes only retired plugins that nothing blocks", async () => {
    const fake = fakeSdk([plugin("studio-code", { enabled: false }), plugin("studio-tables")]);
    await service(fake).enable("studio-code");
    await expect(service(fake).enable("studio-tables")).rejects.toThrow("isn't a BB Studio add-on");
    await expect(service(fake).remove("studio-code")).rejects.toThrow("isn't a retired");
    await service(fake).remove("studio-tables");
    expect(fake.calls.filter((call) => !call.startsWith("rpc"))).toEqual(["enable studio-code", "remove studio-tables"]);
  });
});

describe("retired Studio Reactions", () => {
  it("can be removed only once Studio has copied its settings", async () => {
    const fake = fakeSdk([plugin("emoji-react")]);
    let copied = false;
    const settingsCopied = vi.fn(async (id: string) => id === "emoji-react" && copied);
    const setup = new SetupService({ sdk: fake.sdk, health: async () => health(), settingsCopied });
    const blocked = await setup.remove("emoji-react");
    expect(blocked.failures).toEqual([{ id: "emoji-react", error: expect.stringContaining("hasn't copied its settings") }]);
    expect(fake.calls).not.toContain("remove emoji-react");
    copied = true;
    expect((await setup.summary(0)).retired[0]).toMatchObject({ id: "emoji-react", blocker: null, removeCommand: "bb plugin remove emoji-react" });
    await setup.remove("emoji-react");
    expect(fake.calls).toContain("remove emoji-react");
  });
});

describe("formatSetup", () => {
  it("prints the status, retired plugins and the commands to run", async () => {
    const plugins = allInstalled().filter((each) => each.id !== "mobile").map((each) => (each.id === "studio-code" ? { ...each, enabled: false } : each));
    const { sdk } = fakeSdk([...plugins, plugin("studio-tables")]);
    const text = formatSetup(await buildSetup(sdk, health({ problems: [{ ...problem("studio-code", "degraded", "Editor needs setup"), detail: "Add a key" }] })));
    expect(text).toContain("BB Studio add-ons\n");
    expect(text).toMatch(/ {2}not installed +mobile +Studio Mobile:/);
    expect(text).toMatch(/ {2}disabled +studio-code +Studio Code:/);
    expect(text).not.toContain("smart-decisions");
    expect(text).toMatch(/ {2}ok +studio +Studio:/);
    expect(text).toContain("Retired plugins still installed\n  studio-tables");
    expect(text).toContain("Then remove it: bb plugin remove studio-tables");
    expect(text.trimEnd().endsWith("To finish setup, run:\n  bb plugin enable studio-code")).toBe(true);
  });

  it("says when there's nothing left to run", async () => {
    const text = formatSetup(await buildSetup(fakeSdk(allInstalled()).sdk, health()));
    expect(text).toContain("Every BB Studio add-on is installed and on.");
    expect(text).not.toContain("Retired plugins");
  });
});

describe("SetupService install", () => {
  it("skips an add-on that is already installed and installs one at a time", async () => {
    const plugins = [plugin("studio")];
    const { sdk, raw, calls } = fakeSdk(plugins);
    let active = 0;
    let overlapped = false;
    raw.plugins.catalog.install.mockImplementation(async ({ entryId }: { entryId: string }) => {
      active++;
      overlapped ||= active > 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      plugins.push(plugin(entryId));
      calls.push(`install ${entryId}`);
      active--;
    });
    const service = new SetupService({ sdk, health: async () => health() });
    const [first, second] = await Promise.all([service.install(["studio", "mobile"]), service.install(["mobile", "studio-code"])]);
    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(calls).toEqual(["install mobile", "install studio-code"]);
    expect(overlapped).toBe(false);
  });
});

describe("Decisions bridge retirement", () => {
  it("requires a current, enabled bridge and acknowledged migration", async () => {
    for (const [extra, status, expected] of [
      [{ version: "0.4.0" }, true, "Update Decisions first"],
      [{ version: "0.5.0", enabled: false }, true, "Enable Decisions"],
      [{ version: "0.5.0" }, false, "bb smart-decisions migrate"],
      [{ version: "0.5.0" }, true, null],
    ] as const) {
      const fake = fakeSdk([plugin("smart-decisions", extra)]);
      fake.raw.plugins.callRpc.mockResolvedValue({ complete: status } as never);
      const summary = await buildSetup(fake.sdk, health());
      const retired = summary.retired.find((entry) => entry.id === "smart-decisions")!;
      if (expected === null) expect(retired.blocker).toBeNull();
      else expect(retired.blocker).toContain(expected);
    }
  });
});
