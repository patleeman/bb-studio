import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { fallbackSchema } from "../kit/decisions-legacy-contract";
import { decisionsDefaults, LEGACY_DECISIONS_SETTINGS } from "./settings";

export const IMPORTED = "decisions:imported";
export const secretKeys = ["typesafeApiKey", "vercelApiKey", "openRouterApiKey", "zenApiKey", "customJevApiKey"] as const;
const recentSchema = z.array(z.object({
  at: z.number(), threadId: z.string().max(200), queuedMessageId: z.string().max(200), preview: z.string().max(16000),
  verdict: z.object({ action: z.enum(["steer", "followup"]), source: z.enum(["jev", "model", "default"]), confidence: z.number().nullable(), note: z.string().nullable(), via: z.string().optional() }),
})).max(30).refine((rows) => JSON.stringify(rows).length <= 240_000, "Recent Decisions data exceeds the KV limit.");
const importContract = {
  "decisions.import": {
    input: z.object({
      secrets: z.object(Object.fromEntries(secretKeys.map((key) => [key, z.string().max(16000).optional()]))).strict(),
      fallback: fallbackSchema.nullable(),
      recent: recentSchema.nullable(),
    }).strict(),
    output: z.object({ complete: z.literal(true) }),
  },
};

/** No export endpoint: only the verified bridge may submit server-held secrets. */
export function registerDecisionsImport(bb: BbPluginApi, settings: {
  get(): Promise<Record<string, unknown>>;
  experimental_set(values: Record<string, unknown>): Promise<unknown>;
}) {
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = pending.then(run, run);
    pending = next.catch(() => {});
    return next;
  }
  async function defaults() {
    const current = await settings.get();
    const missing = Object.fromEntries(Object.entries(decisionsDefaults).filter(([key]) => current[`decisions_${key}`] === undefined).map(([key, value]) => [`decisions_${key}`, value]));
    if (Object.keys(missing).length) await settings.experimental_set(missing);
  }
  bb.rpc.register(importContract, {
    "decisions.import": (input, context) => {
      const caller = context.experimental_caller;
      if (caller.kind !== "plugin" || caller.pluginId !== "smart-decisions") throw new Error("Only the Decisions upgrade bridge may import settings.");
      return serial(async () => {
        if (await bb.storage.kv.get(IMPORTED)) return { complete: true as const };
        // Public settings read masks secrets. Never use it as a secret source.
        const { values } = await bb.sdk.plugins.getSettings({ pluginId: "smart-decisions" });
        const current = await settings.get();
        const next: Record<string, unknown> = {};
        for (const [key, descriptor] of Object.entries(LEGACY_DECISIONS_SETTINGS)) {
          const secret = secretKeys.includes(key as typeof secretKeys[number]);
          const value = secret ? input.secrets[key] : values[key];
          if (current[`decisions_${key}`] !== undefined) continue;
          if (value === undefined) continue;
          const schema = "experimental_schema" in descriptor ? descriptor.experimental_schema : descriptor.type === "boolean" ? z.boolean() : descriptor.type === "select" ? z.enum(descriptor.options) : z.string().max(16000);
          if (!schema.safeParse(value).success) throw new Error("Invalid Decisions migration setting.");
          next[`decisions_${key}`] = value;
        }
        if (Object.keys(next).length) await settings.experimental_set(next);
        for (const [key, value] of [["fallback", input.fallback], ["recent-decisions", input.recent]] as const) {
          if (value !== null && await bb.storage.kv.get(`decisions:${key}`) == null) await bb.storage.kv.set(`decisions:${key}`, value);
        }
        await defaults();
        await bb.storage.kv.set(IMPORTED, true);
        return { complete: true as const };
      }).then(async (result) => {
        await bb.experimental_hooks.recheck("message.dispatch");
        return result;
      });
    },
  });
  return {
    ready: () => serial(async () => {
      // Do not classify beside a pre-bridge Decisions, or before its data arrives.
      const { plugins } = await bb.sdk.plugins.list();
      const old = plugins.find((plugin) => plugin.id === "smart-decisions");
      if (old && (!/^0\.(?:[5-9]|[1-9][0-9]+)\.|^[1-9]\d*\./.test(old.version) || !(await bb.storage.kv.get(IMPORTED)))) return false;
      await defaults();
      return true;
    }),
  };
}
