import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ROUTER_CHANNEL, routerContract, type Policy, type Target } from "./contract";
import type { RouterDecisions } from "./decide";
import { ModelRouter, type FailedTurnEvent, type RouterProvider } from "./router";

type Failure = { ok: false; reason?: string; message?: string; unavailable?: boolean; error?: string };

/** BB Studio's fork hooks the router uses, feature-detected. */
interface RouterHooks {
  experimental_autoRouter?: (router: {
    label?: string;
    enabled?: () => boolean;
    isDefault?: () => boolean;
    resolve(request: { projectId: string; text: string; permissionMode?: string | null; signal: AbortSignal }): Promise<Target | null>;
  }) => void;
  experimental_completeText?: (request: { prompt: string; timeoutMs?: number; signal?: AbortSignal }) => Promise<{ ok: true; text: string } | Failure>;
  /** Present on BB Studio's desktop app, which draws its own sign-in prompt on a sign-in failure. */
  experimental_threadForkPoint?: unknown;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fills each target's label with its model's name from the provider's catalog. */
export async function labelled(bb: BbPluginApi, policy: Policy): Promise<Policy> {
  const catalogs = new Map<string, Promise<ReadonlyMap<string, string>>>();
  const names = (providerId: string) => {
    let names = catalogs.get(providerId);
    if (!names) {
      names = bb.sdk.providers.models({ providerId })
        .then((options) => new Map([...options.models, ...(options.selectedOnlyModels ?? [])].map((model) => [model.model, model.displayName] as const)))
        .catch(() => new Map<string, string>());
      catalogs.set(providerId, names);
    }
    return names;
  };
  // No name (an agent that isn't installed has no catalog): no label key at all, since an RPC result can't carry undefined.
  const label = async (target: Target): Promise<Target> => {
    if (target.label) return target;
    const name = (await names(target.providerId)).get(target.model);
    return name ? { ...target, label: name } : target;
  };
  return {
    ...policy,
    rules: await Promise.all(policy.rules.map(async (rule) => ({ ...rule, chain: await Promise.all(rule.chain.map(label)) }))),
    defaultChain: await Promise.all(policy.defaultChain.map(label)),
  };
}

/** The text of a thread's latest provider/error event: ACP agents report their errors only as words. */
export function errorEventText(rows: readonly { type: string; data?: unknown }[]): string | null {
  const row = rows.find((each) => each.type === "provider/error");
  const data = (row?.data ?? null) as { message?: unknown; detail?: unknown } | null;
  if (!data) return null;
  const parts = [data.detail, data.message].filter((part): part is string => typeof part === "string" && part.trim() !== "");
  return parts.length ? parts.join("\n") : null;
}

export async function registerRouter(
  bb: BbPluginApi,
  jev: Pick<RouterDecisions, "systemOne">,
  options: { lean?: (providerId: string, model: string) => boolean } = {},
): Promise<ModelRouter> {
  const hooks = (bb as { experimental_hooks?: RouterHooks }).experimental_hooks;
  const primaryHostId = async () => (await bb.sdk.system.config()).primaryHostId ?? null;
  const completeText = typeof hooks?.experimental_completeText === "function" ? hooks.experimental_completeText.bind(hooks) : null;
  const router = new ModelRouter({
    kv: bb.storage.kv,
    providerStates: async () => {
      const hostId = await primaryHostId();
      return (await bb.sdk.system.providerStates(hostId ? { hostId } : undefined)).providers;
    },
    providers: async () => new Map((await bb.sdk.providers.list()).map((provider) => {
      const modes = (provider as { capabilities?: { permissionModes?: readonly string[] } }).capabilities?.permissionModes ?? [];
      return [provider.id, { name: provider.displayName, permissionModes: [...modes] } satisfies RouterProvider] as const;
    })),
    models: async (providerId) => {
      const options = await bb.sdk.providers.models({ providerId });
      if ((options as { modelLoadError?: unknown }).modelLoadError) return null;
      return new Set([...options.models, ...(options.selectedOnlyModels ?? [])].map((model) => model.model));
    },
    thread: async (threadId) => {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        return {
          id: thread.id, projectId: thread.projectId, providerId: thread.providerId, environmentId: thread.environmentId ?? null,
          title: thread.title ?? null, titleFallback: thread.titleFallback ?? null, status: thread.status, visibility: thread.visibility,
        };
      } catch {
        return null;
      }
    },
    execution: async (threadId) => {
      const options = await bb.sdk.threads.defaultExecutionOptions({ threadId });
      return options ? { model: options.model ?? null, permissionMode: options.permissionMode ?? null, reasoningLevel: options.reasoningLevel ?? null } : null;
    },
    spawn: (request) => bb.sdk.threads.spawn(request as unknown as Parameters<typeof bb.sdk.threads.spawn>[0]),
    cancelRetries: async (threadId) => {
      const rows = await bb.sdk.threads.queuedMessages.list({ threadId });
      let cancelled = 0;
      for (const row of rows) {
        if ((row as { payload?: { kind?: string } }).payload?.kind !== "retry") continue;
        try {
          await bb.sdk.threads.queuedMessages.delete({ threadId, queuedMessageId: row.id });
          cancelled += 1;
        } catch (error) {
          bb.log.warn(`Router: could not cancel queued retry ${row.id} on ${threadId}: ${message(error)}`);
        }
      }
      return cancelled;
    },
    changed: (threadId) => bb.realtime.publish(ROUTER_CHANNEL, { threadId }),
    errorText: async (threadId) => errorEventText(await bb.sdk.threads.events.list({ threadId, types: ["provider/error"], order: "desc", limit: "1" }) as never),
    usage: async (providerId) => {
      const hostId = await primaryHostId();
      const usage = await bb.sdk.system.usageLimits({ providerId, refresh: false, ...(hostId ? { hostId } : {}) }) as Record<string, { status: string } | undefined>;
      return (usage[providerId] ?? null) as never;
    },
    ...(options.lean ? { lean: options.lean } : {}),
    decisions: {
      systemOne: jev.systemOne,
      completeText: completeText
        ? (input, signal) => completeText({ prompt: input.prompt, timeoutMs: input.timeoutMs, signal })
        : null,
    },
    appHandlesSignIn: typeof hooks?.experimental_threadForkPoint === "function",
    log: bb.log,
  });
  await router.load();

  if (typeof hooks?.experimental_autoRouter === "function") {
    hooks.experimental_autoRouter({
      label: "Auto",
      enabled: () => router.enabled(),
      isDefault: () => router.isDefault(),
      resolve: (request) => router.resolve(request),
    });
  }

  bb.events.on("turn.failed", (event) => {
    void router.onTurnFailed(event as FailedTurnEvent).catch((error) => bb.log.warn(`Router: no notice for ${event.threadId}: ${message(error)}`));
  });
  // A new turn (a retry, a message, a manual model change) makes the notice stale.
  bb.events.on("thread.active", ({ thread }) => {
    void router.dismiss(thread.id).catch(() => undefined);
  });
  bb.events.on("thread.archived", ({ thread }) => { void router.forget(thread.id); });
  bb.events.on("thread.deleted", ({ thread }) => { void router.forget(thread.id); });

  bb.rpc.register(routerContract, {
    "router.policy.get": () => router.current(),
    "router.policy.set": async (policy) => router.setPolicy(await labelled(bb, policy)),
    "router.explain": ({ text }) => router.decide(text),
    "router.targets.check": () => router.checkTargets(),
    "router.notice.get": ({ threadId }) => router.notice(threadId),
    "router.notice.dismiss": async ({ threadId }) => {
      await router.dismiss(threadId);
      return { ok: true as const };
    },
    "router.handedOff": ({ threadId }) => router.handedOff(threadId),
    "router.handoff": ({ threadId }) => router.handoff(threadId),
  });
  return router;
}
