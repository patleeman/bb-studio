import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY_PLUGIN_ID } from "./declaration.js";
import { usageFetchMethod, usageListMethod } from "./usage-contract.js";
import { registerUsageSource } from "./usage-source.js";

type Handlers = {
  [usageListMethod]: (input: Record<string, never>) => Promise<{
    resources: Array<{
      id: string;
      accountKey: string | null;
      providerId: string;
      label: string;
      scope: { kind: "host"; hostId: string; hostName: string };
    }>;
  }>;
  [usageFetchMethod]: (input: { resourceId: string; refresh: boolean }) => Promise<{
    accountKey: string | null;
    observedAt: number | null;
    usage: Record<string, unknown>;
  }>;
};

function setup(overrides?: {
  hosts?: Array<{ id: string; name: string; status: string }>;
  providersByHost?: Record<string, Array<{ id: string; pluginId: string; displayName: string }>>;
  usageLimits?: (args: { hostId: string; providerId: string; refresh: boolean }) => Promise<Record<string, unknown>>;
}) {
  const hosts = overrides?.hosts ?? [
    { id: "host_1", name: "Workstation", status: "connected" },
  ];
  const providersByHost = overrides?.providersByHost ?? {
    host_1: [
      { id: "antigravity", pluginId: ANTIGRAVITY_PLUGIN_ID, displayName: "Google Antigravity" },
      { id: "other", pluginId: "other-plugin", displayName: "Other" },
    ],
  };
  const usageLimits = vi.fn(
    overrides?.usageLimits ??
      (async () => ({
        antigravity: {
          status: "ok",
          accountKey: "acct_synthetic_1",
          accountEmail: "user@example.test",
          planLabel: "Pro",
          plan: { id: "pro", multiplier: 2 },
          windows: [
            {
              kind: "five-hour",
              label: "5h window",
              usedPercent: 25,
              resetsAt: "2026-11-27T05:00:00Z",
              model: "gemini-pro",
            },
            {
              kind: "unknown-kind",
              label: "Fallback window",
              usedPercent: 10,
              resetsAt: null,
              model: null,
            },
          ],
        },
      })),
  );

  let registered: Handlers | null = null;
  const bb = {
    sdk: {
      hosts: {
        list: vi.fn(async () => hosts),
        get: vi.fn(async ({ hostId }: { hostId: string }) => {
          const found = hosts.find((h) => h.id === hostId);
          if (!found) {
            throw Object.assign(new Error("Host not found"), { status: 404 });
          }
          return found;
        }),
      },
      providers: {
        list: vi.fn(async ({ hostId }: { hostId: string }) => providersByHost[hostId] ?? []),
      },
      system: {
        usageLimits,
      },
    },
    rpc: {
      register: vi.fn((_contract: unknown, handlers: Handlers) => {
        registered = handlers;
      }),
    },
  } as unknown as BbPluginApi;

  registerUsageSource(bb);
  if (!registered) throw new Error("registerUsageSource did not register RPC handlers");
  return { handlers: registered as Handlers, usageLimits, hosts, providersByHost };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("registerUsageSource", () => {
  it("lists only Antigravity providers, caches fetches for 60s, and evicts stale cache entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T20:00:00Z"));
    const { handlers, usageLimits, providersByHost } = setup();

    const listed = await handlers[usageListMethod]({});
    expect(listed.resources).toEqual([
      {
        id: JSON.stringify(["host_1", "antigravity"]),
        accountKey: null,
        providerId: "antigravity",
        label: "Google Antigravity",
        scope: { kind: "host", hostId: "host_1", hostName: "Workstation" },
      },
    ]);

    const resourceId = listed.resources[0]!.id;
    const first = await handlers[usageFetchMethod]({ resourceId, refresh: false });
    expect(first.accountKey).toBe("acct_synthetic_1");
    expect(first.usage.status).toBe("ok");
    const windows = first.usage.windows as Array<{ id: string; kind: string; cost: unknown }>;
    expect(windows[0]).toMatchObject({ id: "0:5h window", kind: "five-hour", cost: null });
    expect(windows[1]).toMatchObject({ id: "1:Fallback window", kind: "custom", cost: null });
    expect(usageLimits).toHaveBeenCalledTimes(1);

    // Within 60s, !refresh serves the cached measurement.
    vi.advanceTimersByTime(30_000);
    const cached = await handlers[usageFetchMethod]({ resourceId, refresh: false });
    expect(cached).toEqual(first);
    expect(usageLimits).toHaveBeenCalledTimes(1);

    // List now reflects the cached accountKey.
    const listedAfter = await handlers[usageListMethod]({});
    expect(listedAfter.resources[0]!.accountKey).toBe("acct_synthetic_1");

    // refresh: true bypasses the cache.
    await handlers[usageFetchMethod]({ resourceId, refresh: true });
    expect(usageLimits).toHaveBeenCalledTimes(2);

    // Removing the provider evicts its cached accountKey on the next list.
    providersByHost.host_1 = [];
    const empty = await handlers[usageListMethod]({});
    expect(empty.resources).toEqual([]);
  });

  it("coalesces concurrent non-refresh fetches and queues a refresh behind an in-flight non-refresh fetch", async () => {
    let resolveFirst!: (value: Record<string, unknown>) => void;
    let call = 0;
    const { handlers, usageLimits } = setup({
      usageLimits: () => {
        call += 1;
        if (call === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({
          antigravity: {
            status: "ok",
            accountKey: "acct_refreshed",
            accountEmail: "user@example.test",
            planLabel: "Pro",
            windows: [],
          },
        });
      },
    });

    const resourceId = JSON.stringify(["host_1", "antigravity"]);
    const p1 = handlers[usageFetchMethod]({ resourceId, refresh: false });
    const p2 = handlers[usageFetchMethod]({ resourceId, refresh: false });
    const pRefresh = handlers[usageFetchMethod]({ resourceId, refresh: true });

    // Wait a tick for p1's load() to reach usageLimits.
    await vi.waitFor(() => expect(usageLimits).toHaveBeenCalledTimes(1));

    resolveFirst({
      antigravity: {
        status: "ok",
        accountKey: "acct_initial",
        accountEmail: "user@example.test",
        planLabel: "Pro",
        windows: [],
      },
    });

    const [r1, r2, rRefresh] = await Promise.all([p1, p2, pRefresh]);
    expect(r1.accountKey).toBe("acct_initial");
    expect(r2.accountKey).toBe("acct_initial");
    expect(rRefresh.accountKey).toBe("acct_refreshed");
    expect(usageLimits).toHaveBeenCalledTimes(2);
  });

  it("handles missing hosts (404), missing providers, disconnected hosts, and collection errors", async () => {
    const { handlers, hosts } = setup({
      usageLimits: async () => {
        throw new Error("RPC failed");
      },
    });

    await expect(
      handlers[usageFetchMethod]({
        resourceId: JSON.stringify(["host_missing", "antigravity"]),
        refresh: false,
      }),
    ).rejects.toThrow("Usage resource no longer exists.");

    await expect(
      handlers[usageFetchMethod]({
        resourceId: JSON.stringify(["host_1", "unknown_provider"]),
        refresh: false,
      }),
    ).rejects.toThrow("Usage resource no longer exists.");

    const resourceId = JSON.stringify(["host_1", "antigravity"]);
    const errored = await handlers[usageFetchMethod]({ resourceId, refresh: false });
    expect(errored.usage).toMatchObject({
      status: "error",
      message: "Usage could not be collected from this machine.",
    });

    hosts[0]!.status = "disconnected";
    const disconnected = await handlers[usageFetchMethod]({ resourceId, refresh: false });
    expect(disconnected.usage).toMatchObject({
      status: "error",
      message: "Machine is disconnected.",
    });
  });
});
