import { healthSchemas, HEALTH_METHOD, type HealthCheck } from "@bb-studio/kit/health";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { checkHealth, HealthMonitor, statusProblem, type HealthPluginEntry, type HealthSdk } from "./health";

const schemas = healthSchemas(z);
const plugin = (id: string, extra: Partial<HealthPluginEntry> = {}): HealthPluginEntry => ({
  id, name: id.toUpperCase(), enabled: true, status: "running", statusDetail: null, ...extra,
});

function fakeSdk(plugins: HealthPluginEntry[], checks: Record<string, HealthCheck[] | Error>): HealthSdk & { disabled: string[] } {
  const disabled: string[] = [];
  return {
    disabled,
    plugins: {
      list: async () => ({ plugins }),
      experimental_discoverRpc: async ({ method } = {}) => (method === HEALTH_METHOD ? Object.keys(checks).map((pluginId) => ({ pluginId })) : []),
      callRpc: async ({ pluginId, outputSchema }) => {
        const result = checks[pluginId];
        if (result instanceof Error) throw result;
        return outputSchema.parse({ checks: result });
      },
      disable: async ({ pluginId }) => { disabled.push(pluginId); },
    },
  };
}

describe("statusProblem", () => {
  it("reports BB's own problem statuses and leaves running plugins alone", () => {
    expect(statusProblem(plugin("a"))).toBeNull();
    expect(statusProblem(plugin("a", { status: "running", statusDetail: "rpc preview failed: cancelled" }))).toBeNull();
    expect(statusProblem(plugin("a", { status: "needs-configuration", statusDetail: "Add a key." }))).toMatchObject({ status: "degraded", title: "Needs setup", detail: "Add a key." });
    expect(statusProblem(plugin("a", { status: "error" }))).toMatchObject({ status: "broken" });
    expect(statusProblem(plugin("a", { services: [{ name: "hub", state: "backoff" }] }))).toMatchObject({ status: "degraded", title: "hub keeps restarting" });
  });
});

describe("checkHealth", () => {
  it("merges BB status with published checks, broken first, skipping disabled plugins", async () => {
    const sdk = fakeSdk(
      [plugin("decisions"), plugin("old", { status: "incompatible" }), plugin("off", { enabled: false, status: "error" }), plugin("talk")],
      {
        decisions: [{ id: "jev-route", status: "degraded", title: "No Jev provider is set up", fix: { label: "Add a key", path: "/settings/plugins/decisions" } }],
        talk: [{ id: "ready", status: "ok", title: "Transcription works" }],
      },
    );
    const summary = await checkHealth(sdk, schemas, new Set(), 1);
    expect(summary.problems.map((problem) => [problem.pluginId, problem.status, problem.title])).toEqual([
      ["old", "broken", "Doesn't work with this version of BB"],
      ["decisions", "degraded", "No Jev provider is set up"],
    ]);
    expect(summary.problems[1]!.fix).toEqual({ label: "Add a key", path: "/settings/plugins/decisions" });
    expect(summary.problems[0]!.fix.path).toBe("/settings/plugins/old");
    expect(summary.healthy).toEqual([{ pluginId: "talk", pluginName: "TALK", titles: ["Transcription works"] }]);
  });

  it("lists a check that fails instead of dropping it", async () => {
    const summary = await checkHealth(fakeSdk([plugin("a")], { a: new Error("boom") }), schemas, new Set());
    expect(summary.unanswered).toEqual([{ pluginId: "a", pluginName: "A", error: "boom" }]);
  });
});

describe("HealthMonitor", () => {
  function monitor(checks: Record<string, HealthCheck[] | Error>) {
    const store = new Map<string, unknown>();
    const changed = vi.fn();
    const sdk = fakeSdk([plugin("a")], checks);
    const instance = new HealthMonitor({ sdk, schemas, kv: { get: async (key) => store.get(key), set: async (key, value) => { store.set(key, value); } }, changed });
    return { instance, store, changed, sdk };
  }
  const broken: HealthCheck = { id: "key", status: "broken", title: "No key" };

  it("hides a problem until it goes away, then shows it again", async () => {
    const checks: Record<string, HealthCheck[] | Error> = { a: [broken] };
    const { instance } = monitor(checks);
    const [problem] = (await instance.check()).problems;
    expect((await instance.hide(problem!.key, true)).problems[0]!.hidden).toBe(true);
    expect((await instance.check()).problems[0]!.hidden).toBe(true);
    checks.a = [];
    await instance.check();
    checks.a = [broken];
    expect((await instance.check()).problems[0]!.hidden).toBe(false);
  });

  it("keeps a hidden problem while its plugin's check doesn't answer", async () => {
    const checks: Record<string, HealthCheck[] | Error> = { a: [broken] };
    const { instance } = monitor(checks);
    const [problem] = (await instance.check()).problems;
    await instance.hide(problem!.key, true);
    checks.a = new Error("timeout");
    await instance.check();
    checks.a = [broken];
    expect((await instance.check()).problems[0]!.hidden).toBe(true);
  });

  it("keeps a Hide made while a check is running", async () => {
    const { instance, store, sdk } = monitor({ a: [broken] });
    const [problem] = (await instance.check()).problems;
    const answer = sdk.plugins.callRpc;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    sdk.plugins.callRpc = (async (args: Parameters<typeof answer>[0]) => { await gate; return answer(args); }) as typeof answer;
    const running = instance.check();
    await instance.hide(problem!.key, true);
    release();
    expect((await running).problems[0]!.hidden).toBe(true);
    expect(store.get("health-hidden")).toEqual([problem!.key]);
  });

  it("announces only real changes, and reuses a fresh result", async () => {
    const { instance, changed } = monitor({ a: [broken] });
    await instance.check();
    await instance.check();
    const latest = await instance.check();
    // New, then lasting; the third check changes nothing.
    expect(changed).toHaveBeenCalledTimes(2);
    expect(await instance.summary(60_000)).toBe(latest);
    instance.dispose();
  });

  it("calls a problem lasting only once a second check finds it too", async () => {
    vi.useFakeTimers();
    try {
      const checks: Record<string, HealthCheck[] | Error> = { a: [broken] };
      const { instance } = monitor(checks);
      expect((await instance.check()).problems[0]!.lasting).toBe(false);
      // A new problem is checked again soon, without waiting for the next round.
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await instance.summary(60_000)).problems[0]!.lasting).toBe(true);
      checks.a = [];
      await instance.check();
      checks.a = [broken];
      expect((await instance.check()).problems[0]!.lasting).toBe(false);
      instance.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns a plugin off", async () => {
    const { instance, sdk } = monitor({ a: [broken] });
    await instance.disable("a");
    expect(sdk.disabled).toEqual(["a"]);
  });
});
