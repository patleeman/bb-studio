import { getProjectExecutionDefaults, getThread } from "@bb/db";
import type { ProviderInfo } from "@bb/domain";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import type { ExperimentalAutoRouter } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_PROVIDER_ID,
  AUTO_ROUTED,
  autoPermissionMode,
  autoRememberArgs,
  registerAutoRouter,
  resolveAutoForCreate,
  withAutoExecutionOptions,
} from "../../src/services/threads/auto-router.fork.js";
import { forkPluginHooks } from "../../src/services/threads/turn-classifiers.fork.js";
import { rememberProjectExecutionDefaultsForCreate } from "../../src/services/threads/project-execution-defaults.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const disposers: Array<() => void> = [];

function route(router: ExperimentalAutoRouter) {
  disposers.push(registerAutoRouter("studio", router));
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

const realProvider = {
  id: "claude-code",
  pluginId: "provider-claude-code",
  displayName: "Claude Code",
  logoUrl: null,
  maintenance: { health: true, usage: true, installation: true },
  capabilities: {
    supportsThreadArchive: true,
    supportsThreadRename: true,
    supportsServiceTier: true,
    supportsNativeUserQuestion: true,
    supportsFork: true,
    supportsSessionRewind: true,
    permissionModes: ["full"],
    modelCatalogScope: "host",
  },
  composerActions: [],
  completedTurnDisplay: "full",
  available: true,
} as unknown as ProviderInfo;

function options(
  models: SystemExecutionOptionsResponse["models"] = [],
): SystemExecutionOptionsResponse {
  return {
    providers: [realProvider],
    permissionCeiling: "full",
    models,
    selectedOnlyModels: [],
    modelLoadError: null,
  };
}

function request(
  fields: Partial<Parameters<typeof resolveAutoForCreate>[0]> = {},
): Parameters<typeof resolveAutoForCreate>[0] {
  return {
    environment: { type: "project-default" },
    input: [
      { type: "text", text: "Build the settings page", mentions: [] },
      {
        type: "text",
        text: "hidden context",
        mentions: [],
        visibility: "agent-only",
      },
    ],
    origin: "app",
    projectId: "prj_1",
    startedOnBehalfOf: null,
    ...fields,
  } as Parameters<typeof resolveAutoForCreate>[0];
}

describe("Auto in the pickers", () => {
  it("adds nothing without a router", async () => {
    const result = await withAutoExecutionOptions({}, () =>
      Promise.resolve(options()),
    );
    expect(result.providers.map((each) => each.id)).toEqual(["claude-code"]);
  });

  it("lists Auto after the real providers, or first when it is the default", async () => {
    let isDefault = false;
    route({ resolve: () => null, isDefault: () => isDefault });
    const listed = await withAutoExecutionOptions({}, () =>
      Promise.resolve(options()),
    );
    expect(listed.providers.map((each) => each.id)).toEqual([
      "claude-code",
      AUTO_PROVIDER_ID,
    ]);
    expect(listed.providers[1]).toMatchObject({
      displayName: "Auto",
      pluginId: "studio",
      available: true,
    });
    isDefault = true;
    const first = await withAutoExecutionOptions({}, () =>
      Promise.resolve(options()),
    );
    expect(first.providers[0]?.id).toBe(AUTO_PROVIDER_ID);
  });

  it("answers Auto's models with the one Auto model, asking bb for the rest without Auto", async () => {
    route({ resolve: () => null, label: "Auto router" });
    const seen: unknown[] = [];
    const result = await withAutoExecutionOptions(
      { providerId: AUTO_PROVIDER_ID, selectedModel: "auto", hostId: "hst_1" },
      (query) => {
        seen.push(query);
        return Promise.resolve(options());
      },
    );
    expect(seen).toEqual([{ hostId: "hst_1" }]);
    expect(result.models).toEqual([
      expect.objectContaining({ model: "auto", displayName: "Auto router" }),
    ]);
    expect(result.modelLoadError).toBeNull();
  });

  it("hides Auto while the router is turned off", async () => {
    route({ resolve: () => null, enabled: () => false });
    const result = await withAutoExecutionOptions({}, () =>
      Promise.resolve(options()),
    );
    expect(result.providers.map((each) => each.id)).toEqual(["claude-code"]);
  });
});

describe("resolving Auto at creation", () => {
  it("leaves a create that is not Auto alone", async () => {
    route({ resolve: () => ({ providerId: "codex", model: "gpt-5" }) });
    expect(
      await resolveAutoForCreate(
        request({ providerId: "claude-code", model: "opus" }),
        null,
      ),
    ).toBeNull();
  });

  it("swaps Auto for the router's target and passes the visible text", async () => {
    const resolve = vi.fn(() => ({
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high" as const,
    }));
    route({ resolve });
    const fields = await resolveAutoForCreate(
      request({
        providerId: AUTO_PROVIDER_ID,
        model: "auto",
        reasoningLevel: "medium",
        sessionOptions: { fast: "on" },
        executionInputSources: {
          providerId: "client-preference",
          model: "client-preference",
          permissionMode: "explicit",
        },
      }),
      null,
    );
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        text: "Build the settings page",
        parentThreadId: null,
      }),
    );
    expect(fields).toEqual({
      [AUTO_ROUTED]: true,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: undefined,
      sessionOptions: undefined,
      executionInputSources: {
        permissionMode: "explicit",
        providerId: "explicit",
        model: "explicit",
        reasoningLevel: "explicit",
      },
    });
  });

  it("falls back to bb's defaults when the router gives nothing usable", async () => {
    for (const answer of [
      null,
      { providerId: "auto", model: "x" },
      { providerId: "codex", model: "" },
    ]) {
      for (const dispose of disposers.splice(0)) dispose();
      route({ resolve: () => answer as never });
      expect(
        await resolveAutoForCreate(
          request({ providerId: AUTO_PROVIDER_ID, model: "auto" }),
          null,
        ),
      ).toMatchObject({ providerId: undefined, model: undefined });
    }
  });

  it("falls back when the router throws or is late, and cancels it", async () => {
    route({
      resolve: () => {
        throw new Error("boom");
      },
    });
    expect(
      await resolveAutoForCreate(
        request({ providerId: AUTO_PROVIDER_ID }),
        null,
      ),
    ).toMatchObject({ providerId: undefined });
    for (const dispose of disposers.splice(0)) dispose();
    let signal: AbortSignal | null = null;
    route({
      resolve: (args) => {
        signal = args.signal;
        return new Promise(() => undefined);
      },
    });
    expect(
      await resolveAutoForCreate(
        request({ providerId: AUTO_PROVIDER_ID }),
        null,
        null,
        20,
      ),
    ).toMatchObject({ providerId: undefined });
    expect(signal!.aborted).toBe(true);
  });

  it("routes a create that names no model when Auto is the default, workers included, but never a fork", async () => {
    let isDefault = false;
    route({
      resolve: () => ({ providerId: "codex", model: "gpt-5" }),
      isDefault: () => isDefault,
    });
    expect(await resolveAutoForCreate(request(), null)).toBeNull();
    isDefault = true;
    expect(await resolveAutoForCreate(request(), null)).toMatchObject({
      providerId: "codex",
    });
    expect(
      await resolveAutoForCreate(request(), { id: "thr_parent" }),
    ).toMatchObject({ providerId: "codex" });
    expect(
      await resolveAutoForCreate(request({ originKind: "fork" }), null),
    ).toBeNull();
    expect(
      await resolveAutoForCreate(request({ providerId: "claude-code" }), null),
    ).toBeNull();
  });

  it("passes the requested permission mode to the router and marks the create as Auto", async () => {
    const seen: unknown[] = [];
    route({
      resolve: (args) => {
        seen.push(args.permissionMode);
        return { providerId: "codex", model: "gpt-5" };
      },
    });
    const fields = await resolveAutoForCreate(
      request({ providerId: AUTO_PROVIDER_ID, permissionMode: "auto" }),
      null,
    );
    expect(seen).toEqual(["auto"]);
    expect(fields?.[AUTO_ROUTED]).toBe(true);
    expect(JSON.stringify(fields)).not.toContain("autoRouted");
  });

  it("remembers Auto, not the routed model, as the project default", () => {
    const execution = { model: "gpt-5", reasoningLevel: "high" };
    const plain = { execution, request: { providerId: "codex" } };
    expect(autoRememberArgs(plain)).toBe(plain);
    const routed = {
      execution,
      request: { providerId: "codex", [AUTO_ROUTED]: true },
    };
    expect(autoRememberArgs(routed)).toMatchObject({
      execution: { model: "auto", reasoningLevel: "high" },
      request: { providerId: "auto" },
    });
  });

  it("keeps the permission mode within what the routed provider supports, never wider", async () => {
    expect(autoPermissionMode("auto", ["accept-edits", "full"])).toBe(
      "accept-edits",
    );
    expect(autoPermissionMode("full", ["accept-edits", "auto"])).toBe("auto");
    expect(autoPermissionMode("auto", ["auto", "full"])).toBeUndefined();
    expect(autoPermissionMode("accept-edits", ["full"])).toBeUndefined();
    expect(autoPermissionMode(undefined, ["full"])).toBeUndefined();
    expect(autoPermissionMode("auto", null)).toBeUndefined();
    route({ resolve: () => ({ providerId: "acp-glm", model: "glm-5.3" }) });
    const fields = await resolveAutoForCreate(
      request({ providerId: AUTO_PROVIDER_ID, permissionMode: "auto" }),
      null,
      {
        db: {} as never,
        providerRegistry: {
          getSupportedPermissionModes: () => ["accept-edits", "full"],
        },
      },
    );
    expect(fields).toMatchObject({
      providerId: "acp-glm",
      permissionMode: "accept-edits",
    });
  });

  it("registers through the plugin hooks", () => {
    const disposeHooks: Array<() => void | Promise<void>> = [];
    const hooks = forkPluginHooks({
      pluginId: "studio",
      assertLive: () => undefined,
      disposeHooks,
      db: {} as never,
    });
    expect(hooks.experimental_features.autoRouter).toBe(true);
    expect(() => hooks.experimental_autoRouter({} as never)).toThrow(
      /expects \{ resolve \}/u,
    );
    hooks.experimental_autoRouter({ resolve: () => null });
    expect(disposeHooks).toHaveLength(1);
    for (const dispose of disposeHooks) void dispose();
  });
});

describe("POST /threads with Auto", () => {
  async function create(harness: TestAppHarness) {
    const { host } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      status: "ready",
    });
    const response = await harness.app.request("/api/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        origin: "sdk",
        projectId: project.id,
        providerId: AUTO_PROVIDER_ID,
        model: "auto",
        sendAt: Date.now() + 60 * 60 * 1000,
        input: [{ type: "text", text: "Fix the failing test" }],
        environment: { type: "reuse", environmentId: environment.id },
      }),
    });
    return response;
  }

  it("creates the thread on the router's provider and model", async () => {
    await withTestHarness(async (harness) => {
      const texts: string[] = [];
      route({
        resolve: ({ text }) => {
          texts.push(text);
          return { providerId: "codex", model: "gpt-5.1-codex" };
        },
      });
      const response = await create(harness);
      expect(response.status).toBe(201);
      const body = (await readJson(response)) as { id: string };
      const thread = getThread(harness.db, body.id);
      expect(thread?.providerId).toBe("codex");
      expect(thread?.modelOverride ?? "gpt-5.1-codex").toBe("gpt-5.1-codex");
      expect(texts).toEqual(["Fix the failing test"]);
    });
  });

  it("keeps Auto as the project default, so a later root create with no model goes through Auto again", async () => {
    await withTestHarness(async (harness) => {
      route({
        resolve: () => ({ providerId: "codex", model: "gpt-5.1-codex" }),
      });
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const routed = await resolveAutoForCreate(
        request({ projectId: project.id, providerId: AUTO_PROVIDER_ID }),
        null,
        harness.deps,
      );
      rememberProjectExecutionDefaultsForCreate(
        harness.deps,
        autoRememberArgs({
          execution: {
            model: "gpt-5.1-codex",
            reasoningLevel: "medium",
            permissionMode: "full",
            serviceTier: "default",
          },
          request: {
            ...request({ projectId: project.id }),
            ...routed,
            origin: "app",
            originKind: null,
            environment: { type: "project-default" },
          },
        } as never),
      );
      expect(
        getProjectExecutionDefaults(harness.db, { projectId: project.id }),
      ).toMatchObject({ providerId: AUTO_PROVIDER_ID, model: "auto" });
      expect(
        await resolveAutoForCreate(
          request({ projectId: project.id }),
          null,
          harness.deps,
        ),
      ).toMatchObject({ providerId: "codex" });
      // A worker follows its parent, not the project's saved Auto.
      expect(
        await resolveAutoForCreate(
          request({ projectId: project.id }),
          { id: "thr_parent" },
          harness.deps,
        ),
      ).toBeNull();
    });
  });

  it("creates the thread on the usual default when no router is registered", async () => {
    await withTestHarness(async (harness) => {
      const response = await create(harness);
      expect(response.status).toBe(201);
      const body = (await readJson(response)) as { id: string };
      expect(getThread(harness.db, body.id)?.providerId).not.toBe(
        AUTO_PROVIDER_ID,
      );
    });
  });
});
