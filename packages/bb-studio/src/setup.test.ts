import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { HealthSummary, Problem } from "./health-contract";
import { buildSetup, classify, compareVersions, formatSetup, oneLine, SetupService, type SetupPluginEntry, type SetupSdk } from "./setup";
import { ADDONS, MARKETPLACE_NAME } from "./setup-addons";

const plugin = (id: string, extra: Partial<SetupPluginEntry> = {}): SetupPluginEntry => ({ id, name: id, enabled: true, status: "running", version: "1.0.0", ...extra });
const problem = (pluginId: string, status: Problem["status"], title = "Add a key"): Problem => ({
  key: `${pluginId}:${title}`, pluginId, pluginName: pluginId, status, title, detail: null, fix: { label: "Open settings", path: `/settings/plugins/${pluginId}` }, hidden: false, lasting: true,
});
const health = (extra: Partial<HealthSummary> = {}): HealthSummary => ({ checkedAt: 1000, problems: [], healthy: [], unanswered: [], ...extra });

function fakeSdk(plugins: SetupPluginEntry[], opts: { marketplaces?: string[]; chat?: "ok" | Error; installFails?: string[] } = {}) {
  const calls: string[] = [];
  const sdk = {
    plugins: {
      list: async () => ({ plugins }),
      enable: vi.fn(async ({ pluginId }: { pluginId: string }) => { calls.push(`enable ${pluginId}`); }),
      remove: vi.fn(async ({ pluginId }: { pluginId: string }) => { calls.push(`remove ${pluginId}`); }),
      callRpc: vi.fn(async ({ pluginId, method }: { pluginId: string; method: string }) => {
        calls.push(`rpc ${pluginId} ${method}`);
        if (opts.chat instanceof Error) throw opts.chat;
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
    expect(ADDONS).toEqual(marketplace.plugins.map(({ id, displayName, description }) => ({ id, displayName, description })));
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

  it("compares versions", () => {
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
    expect(compareVersions("0.2.0", "0.2")).toBe(0);
    expect(compareVersions("0.10.0-nightly.1", "0.2.0")).toBe(1);
  });
});

describe("buildSetup", () => {
  it("lists every add-on with its status, checks and the commands left", async () => {
    const plugins = allInstalled().filter((each) => !["pages", "mobile"].includes(each.id)).map((each) => (each.id === "talk" ? { ...each, enabled: false } : each));
    const { sdk } = fakeSdk([...plugins, plugin("other")]);
    const summary = await buildSetup(sdk, health({
      problems: [problem("smart-decisions", "degraded", "No Jev provider is set up"), problem("other", "broken", "Stopped")],
      healthy: [{ pluginId: "studio-code", pluginName: "Studio Code", titles: ["code-server found"] }],
    }));
    const byId = Object.fromEntries(summary.addOns.map((addOn) => [addOn.id, addOn]));
    expect(byId.pages).toMatchObject({ status: "not-installed", command: "bb plugin install pages@bb-studio --yes", summary: expect.stringMatching(/^Collaborative pages/) });
    expect(byId.mobile).toMatchObject({ status: "not-installed", optional: expect.stringContaining("iOS") });
    expect(byId.talk).toMatchObject({ status: "disabled", command: "bb plugin enable talk" });
    expect(byId["smart-decisions"]).toMatchObject({ status: "needs-setup", command: null });
    expect(byId["smart-decisions"]!.problems.map((each) => each.title)).toEqual(["No Jev provider is set up"]);
    expect(byId["studio-code"]).toMatchObject({ status: "installed", passed: ["code-server found"] });
    expect(summary.commands).toEqual(["bb plugin install pages@bb-studio --yes", "bb plugin enable talk"]);
    expect(summary.installAll).toBe("bb plugin install pages@bb-studio --yes");
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
    const { sdk } = fakeSdk([...allInstalled(), plugin("float"), plugin("bot-teams", { enabled: false })]);
    const summary = await buildSetup(sdk, health());
    expect(summary.retired.map((each) => each.id)).toEqual(["float", "bot-teams"]);
    expect(summary.retired[0]).toMatchObject({ blocker: null, removeCommand: "bb plugin remove float", kept: expect.any(String), deleted: expect.stringContaining("settings") });
    expect(summary.retired[1]!.before.map((each) => each.command)).toContain("bb bots list --json");
  });

  it("blocks removing Studio Chat until its links are in Studio", async () => {
    const old = await buildSetup(fakeSdk([plugin("studio-chat", { version: "0.1.0" })]).sdk, health());
    expect(old.retired[0]!.blocker).toMatch(/before the upgrade bridge.*bb studio-chat migrate/);
    const off = await buildSetup(fakeSdk([plugin("studio-chat", { version: "0.2.0", enabled: false })]).sdk, health());
    expect(off.retired[0]!.blocker).toMatch(/turned off/);
    const failing = await buildSetup(fakeSdk([plugin("studio-chat", { version: "0.2.0" })], { chat: new Error("Studio is unavailable") }).sdk, health());
    expect(failing.retired[0]!.blocker).toMatch(/Studio is unavailable.*bb studio-chat migrate/);
    const { sdk, calls } = fakeSdk([plugin("studio-chat", { version: "0.2.0" })], { chat: "ok" });
    const done = await buildSetup(sdk, health());
    expect(done.retired[0]!.blocker).toBeNull();
    expect(calls).toEqual(["rpc studio-chat viewing"]);
  });

  it("blocks removing Studio Navigation until Studio Sidebar is on", async () => {
    const without = await buildSetup(fakeSdk([plugin("studio-navigation")]).sdk, health());
    expect(without.retired[0]!.blocker).toContain("bb plugin install thread-list-plus@bb-studio --yes");
    const off = await buildSetup(fakeSdk([plugin("studio-navigation"), plugin("thread-list-plus", { enabled: false })]).sdk, health());
    expect(off.retired[0]!.blocker).toContain("bb plugin enable thread-list-plus");
    const on = await buildSetup(fakeSdk([plugin("studio-navigation"), plugin("thread-list-plus")]).sdk, health());
    expect(on.retired[0]!.blocker).toBeNull();
  });
});

describe("SetupService", () => {
  const service = (fake: ReturnType<typeof fakeSdk>) => new SetupService({ sdk: fake.sdk, health: async () => health() });

  it("installs from the bb-studio marketplace with the source BB resolved, and reports failures", async () => {
    const fake = fakeSdk([plugin("studio")], { installFails: ["talk"] });
    const result = await service(fake).install(["pages", "talk"]);
    expect(fake.calls).toEqual(["install pages@bb-studio confirmed"]);
    expect(result.failures).toEqual([{ id: "talk", error: "permission denied" }]);
    await expect(service(fake).install(["not-ours"])).resolves.toMatchObject({ failures: [{ id: "not-ours", error: expect.stringContaining("isn't a BB Studio add-on") }] });
  });

  it("refuses an incompatible add-on", async () => {
    const fake = fakeSdk([]);
    fake.raw.plugins.catalog.installPlan.mockResolvedValueOnce({ kind: "marketplace", compatible: false, incompatibleReason: "Needs BB 0.50" as never, resolvedSource: {} as never });
    const result = await service(fake).install(["pages"]);
    expect(result.failures).toEqual([{ id: "pages", error: "Needs BB 0.50" }]);
    expect(fake.raw.plugins.catalog.install).not.toHaveBeenCalled();
  });

  it("enables only add-ons and removes only retired plugins that nothing blocks", async () => {
    const fake = fakeSdk([plugin("talk", { enabled: false }), plugin("float"), plugin("studio-chat", { version: "0.2.0" })], { chat: new Error("not yet") });
    await service(fake).enable("talk");
    await expect(service(fake).enable("float")).rejects.toThrow("isn't a BB Studio add-on");
    await expect(service(fake).remove("pages")).rejects.toThrow("isn't a retired");
    const blocked = await service(fake).remove("studio-chat");
    expect(blocked.failures[0]!.error).toMatch(/bb studio-chat migrate/);
    await service(fake).remove("float");
    expect(fake.calls.filter((call) => !call.startsWith("rpc"))).toEqual(["enable talk", "remove float"]);
  });
});

describe("formatSetup", () => {
  it("prints the status, retired plugins and the commands to run", async () => {
    const plugins = allInstalled().filter((each) => each.id !== "pages").map((each) => (each.id === "talk" ? { ...each, enabled: false } : each));
    const { sdk } = fakeSdk([...plugins, plugin("float")]);
    const text = formatSetup(await buildSetup(sdk, health({ problems: [{ ...problem("smart-decisions", "degraded", "No Jev provider is set up"), detail: "Add a key" }] })));
    expect(text).toContain("BB Studio add-ons\n");
    expect(text).toMatch(/ {2}not installed +pages +Studio Pages: Collaborative pages/);
    expect(text).toMatch(/ {2}disabled +talk +Studio Talk:/);
    expect(text).toMatch(/ {2}needs setup +smart-decisions +Studio Decisions:.*\n +degraded: No Jev provider is set up\. Add a key/);
    expect(text).toMatch(/ {2}ok +studio +Studio:/);
    expect(text).toContain("Retired plugins still installed\n  float");
    expect(text).toContain("Then remove it: bb plugin remove float");
    expect(text.trimEnd().endsWith("To finish setup, run:\n  bb plugin install pages@bb-studio --yes\n  bb plugin enable talk")).toBe(true);
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
    const [first, second] = await Promise.all([service.install(["studio", "pages"]), service.install(["pages", "talk"])]);
    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(calls).toEqual(["install pages", "install talk"]);
    expect(overlapped).toBe(false);
  });
});

describe("turning on a retired plugin", () => {
  it("tells a turned-off Studio Chat the exact command and allows turning it on, nothing else retired", async () => {
    const chat = plugin("studio-chat", { enabled: false, version: "0.2.0" });
    const { sdk, calls } = fakeSdk([...allInstalled(), chat, plugin("float")]);
    const service = new SetupService({ sdk, health: async () => health() });
    const summary = await service.summary(0);
    expect(summary.retired.find((entry) => entry.id === "studio-chat")!.blocker).toContain("`bb plugin enable studio-chat`");
    await service.enable("studio-chat");
    expect(calls).toContain("enable studio-chat");
    await expect(service.enable("float")).rejects.toThrow(/isn't a BB Studio add-on/);
    chat.enabled = true;
    expect((await service.enable("studio-chat")).failures[0]!.error).toMatch(/isn't turned off/);
  });
});
