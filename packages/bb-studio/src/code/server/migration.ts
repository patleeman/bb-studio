import { z } from "zod";
import { studioSchemas } from "@bb-studio/kit/contract";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { dirname, join, resolve } from "node:path";
import { codeImportContract } from "@bb-studio/kit/code-import-contract";
import { quiesceCode } from "@bb-studio/kit/code-handover";
import { copyCodeFiles } from "./import-files";

export const CODE_IMPORTED = "code:imported";
const FILES_IMPORTED = "code:files-imported";

export function registerCodeImport(bb: BbPluginApi, db: Database.Database, root: string, refreshed: () => Promise<void>) {
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = pending.then(run, run);
    pending = next.catch(() => {});
    return next;
  }
  const onlyBridge = (caller: { kind: string; pluginId?: string }) => {
    if (caller.kind !== "plugin" || caller.pluginId !== "studio-code") throw new Error("Only the Studio Code upgrade bridge may import editor data.");
  };
  bb.rpc.register(codeImportContract, {
    "code.importFiles": (input, context) => {
      onlyBridge(context.experimental_caller);
      return serial(async () => {
        if (await bb.storage.kv.get(FILES_IMPORTED)) return { complete: true as const };
        // The bridge and Studio have sibling plugin data directories on this host.
        const source = join(dirname(dirname(db.name)), "studio-code");
        if (resolve(input.sourceRoot) !== resolve(source)) throw new Error("Unexpected Code migration source directory.");
        // Verify the process fence on the receiving side as well. No data writes on failure.
        await quiesceCode(source);
        await copyCodeFiles(source, root);
        if (input.theme !== null && await bb.storage.kv.get("code:theme") == null) await bb.storage.kv.set("code:theme", input.theme);
        await refreshed();
        await bb.storage.kv.set(FILES_IMPORTED, true);
        return { complete: true as const };
      });
    },
    "code.importRows": (input, context) => {
      onlyBridge(context.experimental_caller);
      return serial(async () => {
        if (!(await bb.storage.kv.get(FILES_IMPORTED))) throw new Error("Copy the editor files before its rows.");
        const insert = (table: string, rows: Record<string, unknown>[]) => {
          for (const row of rows) {
            const keys = Object.keys(row);
            db.prepare(`INSERT OR IGNORE INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((key) => row[key]));
          }
          return rows.map((row) => row.id as string);
        };
        return db.transaction(() => ({ workspaces: insert("code_workspaces", input.workspaces), comments: insert("code_comments", input.comments) }))();
      });
    },
    "code.finishImport": (_input, context) => {
      onlyBridge(context.experimental_caller);
      return serial(async () => {
        if (!(await bb.storage.kv.get(FILES_IMPORTED))) throw new Error("Editor files have not been copied.");
        await bb.storage.kv.set(CODE_IMPORTED, true);
        bb.realtime.publish("studio-code-changed", { id: "*" });
        // Best effort, like other built-ins: an open collection can always refetch.
        void Promise.resolve().then(() => bb.sdk.plugins.callRpc({ pluginId: "studio", method: "studio_changed", input: { pluginId: "studio-code" }, outputSchema: studioSchemas(z).changed.output })).catch(() => {});
        return { complete: true as const };
      });
    },
  });
  return {
    requireReady: () => serial(async () => {
      const { plugins } = await bb.sdk.plugins.list();
      const old = plugins.find((plugin) => plugin.id === "studio-code");
      if (old && (!/^(?:0\.(?:[2-9]|[1-9][0-9]+)\.|[1-9]\d*\.)/.test(old.version) || !(await bb.storage.kv.get(CODE_IMPORTED)))) throw new Error("Update Studio Code first, then Studio, and run bb studio-code migrate. Its editor data has not finished copying.");
    }),
  };
}
