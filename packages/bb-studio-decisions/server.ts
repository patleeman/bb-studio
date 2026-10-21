import { setTimeout as sleep } from "node:timers/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "./contract";
import { healthSchemas } from "@bb-studio/kit/health";
import { LEGACY_SETTINGS, SECRET_KEYS } from "./src/settings";

const acknowledged = z.object({ complete: z.literal(true) });
const cliResult = z.object({ exitCode: z.number(), stdout: z.string().optional(), stderr: z.string().optional() });
const marker = "studio:migrated";

/** Upgrade bridge only: no queue hooks, listeners, classifiers or tools. */
export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define(LEGACY_SETTINGS);
  let copying: Promise<void> | undefined;
  async function migrate() {
    if (await bb.storage.kv.get(marker)) return;
    if (copying) return copying;
    copying = (async () => {
      // Quiesce classifier sessions left by the pre-bridge load before handing
      // ownership to Studio. Collect first so offset paging cannot skip rows.
      const stale: string[] = [];
      for (let offset = 0; ; offset += 100) {
        const threads = await bb.sdk.threads.list({ originPluginId: "smart-decisions", includeHidden: true, limit: 100, offset });
        for (const thread of threads) if (thread.visibility === "hidden" && thread.title?.startsWith("Studio Decisions · ")) stale.push(thread.id);
        if (threads.length < 100) break;
      }
      for (const threadId of stale) {
        await bb.sdk.threads.stop({ threadId }).catch((error) => { if (!/not found|HTTP 404/i.test(String(error))) throw new Error("A previous Decisions classifier could not be stopped."); });
        await bb.sdk.threads.delete({ threadId, childThreadsConfirmed: false }).catch((error) => { if (!/not found|HTTP 404/i.test(String(error))) throw new Error("A previous Decisions classifier could not be removed."); });
      }
      const own = await settings.get();
      const secrets = Object.fromEntries(SECRET_KEYS.flatMap((key) => typeof own[key] === "string" ? [[key, own[key]]] : []));
      await bb.sdk.plugins.callRpc({
        pluginId: "studio", method: "decisions.import",
        input: { secrets, fallback: await bb.storage.kv.get("fallback") ?? null, recent: await bb.storage.kv.get("recent-decisions") ?? null },
        outputSchema: acknowledged,
      });
      await bb.storage.kv.set(marker, true);
    })().finally(() => { copying = undefined; });
    return copying;
  }
  const legacy = { ...rpcContract, ...healthSchemas(z).contract };
  bb.rpc.register(legacy, Object.fromEntries(Object.entries(legacy).map(([method, contract]) => [method, async (input: unknown) => {
    await migrate();
    return bb.sdk.plugins.callRpc({ pluginId: "studio", method: `decisions.${method}`, input: input as never, outputSchema: contract.output as z.ZodType<unknown>, signal: AbortSignal.timeout(120_000) });
  }])) as never);
  bb.rpc.register({ migrationStatus: { input: z.null(), output: z.object({ complete: z.boolean() }) } }, {
    migrationStatus: async () => { await migrate().catch(() => {}); return { complete: !!(await bb.storage.kv.get(marker)) }; },
  });
  bb.cli.register({
    name: "smart-decisions", summary: "Compatibility bridge to bb studio decisions",
    commands: ["status", "recent", "classify", "check", "fallback", "migrate"].map((name) => ({ name, usage: `bb smart-decisions ${name}`, summary: name === "migrate" ? "Finish copying Decisions into Studio" : `Forward ${name} to Studio` })),
    async run(argv) {
      await migrate();
      if (argv[0] === "migrate") return { exitCode: 0, stdout: "Migration complete" };
      return bb.sdk.plugins.callRpc({ pluginId: "studio", method: "decisions.cli", input: { argv }, outputSchema: cliResult, signal: AbortSignal.timeout(120_000) });
    },
  });
  bb.background.service("migration", {
    async start(signal) {
      let delay = 1000;
      while (!signal.aborted) {
        try { await migrate(); return; }
        catch { bb.log.warn("Decisions migration is waiting for Studio; it will retry."); }
        await sleep(delay, undefined, { signal }).catch(() => {});
        delay = Math.min(delay * 2, 30_000);
      }
    },
  });
}
