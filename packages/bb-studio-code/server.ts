// Upgrade bridge only: never starts code-server or registers tools/UI.
import { setTimeout as sleep } from "node:timers/promises";
import { dirname } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { codeContract } from "@bb-studio/kit/code-contract";
import { codeImportContract, acknowledged } from "@bb-studio/kit/code-import-contract";
import { MIGRATIONS } from "@bb-studio/kit/code-migrations";
import { quiesceCode } from "@bb-studio/kit/code-handover";

const marker = "studio:migrated";
export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  let copying: Promise<void> | undefined;
  async function migrate() {
    if (await bb.storage.kv.get(marker)) return;
    if (copying) return copying;
    copying = (async () => {
      const root = dirname(db.name);
      // BB disposes the old implementation before loading this bridge. Also
      // stop orphan watchdogs/children and WAIT for exit before any copy.
      await quiesceCode(root);
      await bb.sdk.plugins.callRpc({ pluginId: "studio", method: "code.importFiles", input: { sourceRoot: root, theme: await bb.storage.kv.get("theme") ?? null }, outputSchema: acknowledged, signal: AbortSignal.timeout(30 * 60_000) });
      for (const [table, key] of [["code_workspaces", "workspaces"], ["code_comments", "comments"]] as const) {
        let after = "";
        for (;;) {
          const rows = db.prepare(`SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT 100`).all(after) as { id: string }[];
          if (!rows.length) break;
          const remaining = [];
          for (const row of rows) if (!(await bb.storage.kv.get(`migrated:${table}:${row.id}`))) remaining.push(row);
          if (remaining.length) {
            const input = codeImportContract["code.importRows"].input.parse({ workspaces: [], comments: [], [key]: remaining });
            const result = await bb.sdk.plugins.callRpc({ pluginId: "studio", method: "code.importRows", input, outputSchema: codeImportContract["code.importRows"].output });
            if (remaining.some((row) => !result[key].includes(row.id))) throw new Error("Studio did not acknowledge every Code row.");
            for (const id of result[key]) await bb.storage.kv.set(`migrated:${table}:${id}`, true);
          }
          after = rows.at(-1)!.id;
        }
      }
      await bb.sdk.plugins.callRpc({ pluginId: "studio", method: "code.finishImport", input: null, outputSchema: acknowledged });
      await bb.storage.kv.set(marker, true);
    })().finally(() => { copying = undefined; });
    return copying;
  }
  bb.rpc.register(codeContract, Object.fromEntries(Object.entries(codeContract).map(([method, contract]) => [method, async (input: unknown) => {
    await migrate();
    return bb.sdk.plugins.callRpc({ pluginId: "studio", method: `code.${method}`, input: input as never, outputSchema: contract.output as z.ZodType<unknown>, signal: AbortSignal.timeout(30 * 60_000) });
  }])) as never);
  bb.rpc.register({ migrationStatus: { input: z.null(), output: z.object({ complete: z.boolean() }) } }, {
    migrationStatus: async () => { await migrate().catch(() => {}); return { complete: !!(await bb.storage.kv.get(marker)) }; },
  });
  // Mentions are plugin-scoped: old saved pills still resolve through the bridge.
  bb.ui.registerMentionProvider({
    id: "workspace", label: "Workspaces (moved to Studio)",
    search: () => [],
    resolve: async (id) => {
      await migrate();
      const { workspace } = await bb.sdk.plugins.callRpc({ pluginId: "studio", method: "code.get", input: { id }, outputSchema: codeContract.get.output });
      if (!workspace) throw new Error("Workspace not found.");
      return { context: `${workspace.title}\n${workspace.folders.join("\n")}\n/plugins/studio/studio/workspaces/${encodeURIComponent(id)}` };
    },
  });
  bb.cli.register({
    name: "studio-code", summary: "Studio Code upgrade bridge",
    commands: [{ name: "migrate", usage: "bb studio-code migrate", summary: "Finish copying editor data into Studio" }],
    async run(argv) {
      if (argv[0] !== "migrate") return { exitCode: 1, stderr: "Usage: bb studio-code migrate" };
      await migrate();
      return { exitCode: 0, stdout: "Migration complete" };
    },
  });
  bb.background.service("migration", {
    async start(signal) {
      let delay = 1000;
      while (!signal.aborted) {
        try { await migrate(); return; }
        catch { bb.log.warn("Studio Code migration is waiting for a stopped editor and Studio; it will retry."); }
        await sleep(delay, undefined, { signal }).catch(() => {});
        delay = Math.min(delay * 2, 30_000);
      }
    },
  });
}
