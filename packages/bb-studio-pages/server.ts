// Studio Pages (plugin id `pages`), last release: the upgrade bridge.
//
// Pages are built into Studio now (packages/bb-studio/src/pages), with
// Explore's Next row (packages/bb-studio/src/explore). BB keeps a plugin's
// database, KV, settings and files per plugin id, so this release copies the
// old pages with their versions and uploaded files, the Next row's click log
// (explore.db) and the user's Pages and Explore settings into Studio
// (src/migrate.ts), and forwards what older clients still call here. It
// registers no UI, agent tools, commands or skill: Studio has those, under the
// same names, and BB refuses a tool name two plugins register.
//
// - On start, and until one pass completes, it copies into Studio, retrying
//   with backoff while Studio is missing, off or starting.
// - `bb pages migrate` runs the copy now and reports it.
// - `migrationStatus` tells Studio's Setup page whether it can be removed.
// - Old RPCs (iOS builds from before the merge) and old `@page` mention pills
//   forward to Studio once the copy is complete, and the old file, upload and
//   Mermaid URLs redirect to Studio's.
// - The originals stay in this plugin's database; removing the plugin deletes them.
import { bridgeContract, bridgeStatusContract, PAGES_SETTINGS, pagesSettingsSchema, rpcContract, type MigrationStatus, type PagesSettings } from "@bb-studio/kit/pages-contract";
import { STUDIO_PLUGIN_ID } from "@bb-studio/kit/contract";
import { defineItemMention } from "@bb-studio/kit/server";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { MIGRATIONS, migrate, type StudioImport } from "./src/migrate";

const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 10 * 60_000;
const CALL_TIMEOUT_MS = 60_000;

type Contract = typeof rpcContract & typeof bridgeContract;
type Method = keyof Contract;

/** The old method names: Studio's `pages.<name>` without the prefix. */
export const LEGACY_METHODS = Object.keys(rpcContract).map((name) => name.slice("pages.".length));
/** The old plugin's client methods, forwarded to Studio; iOS falls back to them for one release. */
export const legacyContract = defineRpcContract(Object.fromEntries(Object.entries(rpcContract).map(([name, spec]) => [name.slice("pages.".length), spec])) as {
  [K in keyof typeof rpcContract as K extends `pages.${infer Name}` ? Name : never]: (typeof rpcContract)[K];
});

/** Where Studio serves what this plugin's HTTP routes used to. */
export const STUDIO_HTTP = "/api/v1/plugins/studio/http/pages";

/**
 * Pages' and Explore's settings, defined again only to read what the user had
 * set; Studio copies them once. They're on Studio's settings page now.
 */
const SETTINGS = Object.fromEntries(Object.entries(PAGES_SETTINGS).map(([key, descriptor]) => [key, {
  ...descriptor,
  label: `${descriptor.label} (moved to Studio)`,
  description: "Pages are built into Studio: this setting is on Studio's settings page now, and `bb pages migrate` copied it there once. Changing it here does nothing.",
}])) as unknown as typeof PAGES_SETTINGS;

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const settings = bb.settings.define(SETTINGS);

  const call = <M extends Method>(method: M, input: z.input<Contract[M]["input"]>, timeoutMs = CALL_TIMEOUT_MS): Promise<z.output<Contract[M]["output"]>> => {
    const spec = ((rpcContract as Record<string, unknown>)[method] ?? (bridgeContract as Record<string, unknown>)[method]) as Contract[M];
    return bb.sdk.plugins.callRpc({
      pluginId: STUDIO_PLUGIN_ID, method, input: input as never,
      outputSchema: spec.output as unknown as z.ZodType<z.output<Contract[M]["output"]>>, signal: AbortSignal.timeout(timeoutMs),
    });
  };
  const studio: StudioImport = {
    missingFiles: (ids) => call("pages.missingFiles", { ids }),
    importFile: (file) => call("pages.importFile", file),
    importSnapshots: (snapshots) => call("pages.importSnapshots", { snapshots }),
    importRows: (pages) => call("pages.importRows", { pages }),
    importNext: (rows) => call("explore.importNextSuggestions", { rows }),
    importSettings: (values) => call("pages.importSettings", { settings: values }),
  };

  // Explore kept the Next row's click log in explore.db, beside this plugin's database.
  const main = (db.pragma("database_list") as { name: string; file: string }[]).find((entry) => entry.name === "main");
  const explorePath = join(main?.file ? dirname(main.file) : join(bb.server.experimental_dataDir, "plugins", bb.pluginId), "explore.db");
  const openExplore = (): Database.Database | null => {
    if (!existsSync(explorePath)) return null;
    const Constructor = db.constructor as new (path: string, options?: Database.Options) => Database.Database;
    return new Constructor(explorePath, { readonly: true, fileMustExist: true });
  };
  const oldSettings = async (): Promise<PagesSettings> => {
    const parsed = pagesSettingsSchema.safeParse(await settings.get());
    return parsed.success ? parsed.data : {};
  };

  const count = (db.prepare("SELECT COUNT(*) AS n FROM pages").get() as { n: number }).n;
  let status: MigrationStatus = { complete: false, total: count, copied: 0, skipped: [], error: null };
  let running: Promise<MigrationStatus> | null = null;
  const runMigration = () => running ??= (async () => {
    const explore = openExplore();
    try {
      return await migrate(db, studio, bb.storage.kv, { explore, settings: oldSettings });
    } finally {
      explore?.close();
    }
  })()
    .then((result) => {
      status = { ...result, error: null };
      if (result.skipped.length) bb.log.warn(`Skipped ${result.skipped.length} pages that can't be copied (kept here): ${result.skipped.map((each) => `${each.id} (${each.reason})`).join(", ")}`);
      return status;
    }, (error: unknown) => {
      status = { ...status, error: error instanceof Error ? error.message : String(error) };
      throw error;
    })
    .finally(() => { running = null; });
  /** Forwarded calls wait for a complete copy, so they never miss a page. */
  const ready = async () => { if (!status.complete) await runMigration(); };

  bb.rpc.register(bridgeStatusContract, { migrationStatus: () => status });
  bb.rpc.register(legacyContract, Object.fromEntries(LEGACY_METHODS.map((name) => [name, async (input: unknown) => {
    await ready();
    return call(`pages.${name}` as Method, input as never);
  }])) as never);

  // The old file, upload and Mermaid URLs, for clients, pages and threads
  // from before the merge: the same query on Studio's routes, same origin.
  // An upload keeps its method and body (307).
  for (const route of ["files", "mermaid.js"]) {
    bb.http.route("GET", `/${route}`, async (context) => {
      if (route === "files") await ready();
      const query = new URL(context.req.url).search;
      return context.redirect(`${STUDIO_HTTP}/${route}${query}`, 302);
    });
  }
  bb.http.route("POST", "/upload", async (context) => {
    await ready();
    return context.redirect(`${STUDIO_HTTP}/upload`, 307);
  });

  // `@page` pills in threads from before the merge name this plugin;
  // Studio's own `page` provider takes new mentions.
  bb.ui.registerMentionProvider(defineItemMention({
    id: "page",
    label: "Pages (old)",
    search: () => [],
    async resolve(id) {
      await ready();
      return { context: (await call("pages.mentionContext", { id })).context };
    },
  }));

  bb.cli.register({
    name: "pages",
    summary: "Copy your pages into Studio (Pages is built into Studio now)",
    commands: [{ name: "migrate", summary: "Copy every page, its versions and files, the Next row's click stats and your Pages settings into Studio, then report", usage: "bb pages migrate" }],
    async run(argv) {
      if (argv[0] !== "migrate") {
        return { exitCode: 1, stderr: "Pages are built into Studio now: use `bb studio pages <list|show|create|append>` and `bb studio pages explore stats`.\nThis plugin only copies your old pages into Studio: bb pages migrate\n" };
      }
      try {
        const result = await runMigration();
        const skipped = result.skipped.length
          ? `Skipped ${result.skipped.length} that can't be copied, kept here as they were:\n${result.skipped.map((each) => `  ${each.id}: ${each.reason}`).join("\n")}\n`
          : "";
        return { exitCode: 0, stdout: `${skipped}${result.copied} of ${result.total} pages, with their versions, files and comments, the Next row's click stats and your Pages settings are in Studio. Migration complete.\n` };
      } catch (error) {
        return { exitCode: 1, stderr: `Couldn't copy into Studio. Update and turn on Studio, then retry: ${error instanceof Error ? error.message : String(error)}\n` };
      }
    },
  });

  // Studio may be missing, off, or still starting: retry with backoff until
  // one pass completes (a forwarded call or the CLI may finish it first).
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = (delay: number) => {
    timer = setTimeout(() => {
      if (disposed || status.complete) return;
      runMigration().catch((error: unknown) => {
        if (disposed || status.complete) return;
        bb.log.warn(`Copying pages into Studio will retry in ${Math.round(delay / 1000)}s: ${String(error)}`);
        attempt(Math.min(delay * 2, MAX_RETRY_MS));
      });
    }, delay);
  };
  bb.onDispose(() => { disposed = true; clearTimeout(timer); });
  attempt(FIRST_RETRY_MS);
}
