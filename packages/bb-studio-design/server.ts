// Studio Design (plugin id `design`), last release: the upgrade bridge.
//
// Designs are built into Studio now (packages/bb-studio/src/design). BB keeps
// a plugin's database per plugin id, so this release copies the old rows
// (designs with their rounds, screens and comments, and saved styles) into
// Studio (src/migrate.ts) and forwards what older clients still call here. It
// registers no UI, agent tools or skill: Studio has those, under the same
// names, and BB refuses a tool name two plugins register.
//
// - On start, and until one pass completes, it copies into Studio, retrying
//   with backoff while Studio is missing, off or starting.
// - `bb design migrate` runs the copy now and reports it.
// - `migrationStatus` tells Studio's Setup page whether it can be removed.
// - Old RPCs (iOS builds from before the merge) and old `@design` mention
//   pills forward to Studio once the copy is complete, and the old screen and
//   print URLs redirect to Studio's.
import { bridgeContract, bridgeStatusContract, rpcContract, type MigrationStatus } from "@bb-studio/kit/design-contract";
import { STUDIO_PLUGIN_ID } from "@bb-studio/kit/contract";
import { defineItemMention } from "@bb-studio/kit/server";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { MIGRATIONS, migrate, type StudioImport } from "./src/migrate";

const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 10 * 60_000;
const CALL_TIMEOUT_MS = 60_000;

type Contract = typeof rpcContract & typeof bridgeContract;
type Method = keyof Contract;

/** The old method names: Studio's `designs.<name>` without the prefix. */
export const LEGACY_METHODS = Object.keys(rpcContract).map((name) => name.slice("designs.".length));
/** The old plugin's client methods, forwarded to Studio; iOS falls back to them for one release. */
export const legacyContract = defineRpcContract(Object.fromEntries(Object.entries(rpcContract).map(([name, spec]) => [name.slice("designs.".length), spec])) as {
  [K in keyof typeof rpcContract as K extends `designs.${infer Name}` ? Name : never]: (typeof rpcContract)[K];
});

/** Where Studio serves what this plugin's HTTP routes used to. */
export const STUDIO_HTTP = "/api/v1/plugins/studio/http/designs";

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const call = <M extends Method>(method: M, input: z.input<Contract[M]["input"]>, timeoutMs = CALL_TIMEOUT_MS): Promise<z.output<Contract[M]["output"]>> => {
    const spec = ((rpcContract as Record<string, unknown>)[method] ?? (bridgeContract as Record<string, unknown>)[method]) as Contract[M];
    return bb.sdk.plugins.callRpc({
      pluginId: STUDIO_PLUGIN_ID, method, input: input as never,
      outputSchema: spec.output as unknown as z.ZodType<z.output<Contract[M]["output"]>>, signal: AbortSignal.timeout(timeoutMs),
    });
  };
  const studio: StudioImport = {
    importRows: (designs) => call("designs.importRows", { designs }),
    importStyles: (styles) => call("designs.importStyles", { styles }),
  };

  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  let status: MigrationStatus = { complete: false, total: count("designs") + count("design_styles"), copied: 0, skipped: [], error: null };
  let running: Promise<MigrationStatus> | null = null;
  const runMigration = () => running ??= migrate(db, studio, bb.storage.kv)
    .then((result) => {
      status = { ...result, error: null };
      if (result.skipped.length) bb.log.warn(`Skipped ${result.skipped.length} rows that can't be copied (kept here): ${result.skipped.map((each) => `${each.id} (${each.reason})`).join(", ")}`);
      return status;
    }, (error: unknown) => {
      status = { ...status, error: error instanceof Error ? error.message : String(error) };
      throw error;
    })
    .finally(() => { running = null; });
  /** Forwarded calls wait for a complete copy, so they never miss a design. */
  const ready = async () => { if (!status.complete) await runMigration(); };

  bb.rpc.register(bridgeStatusContract, { migrationStatus: () => status });
  bb.rpc.register(legacyContract, Object.fromEntries(LEGACY_METHODS.map((name) => [name, async (input: unknown) => {
    await ready();
    return call(`designs.${name}` as Method, input as never);
  }])) as never);

  // The old screen and print URLs, for clients and threads from before the
  // merge: the same query on Studio's routes, same origin.
  for (const route of ["screen", "print"]) {
    bb.http.route("GET", `/${route}`, async (context) => {
      await ready();
      const query = new URL(context.req.url).search;
      return context.redirect(`${STUDIO_HTTP}/${route}${query}`, 302);
    });
  }

  // `@design` pills in threads from before the merge name this plugin;
  // Studio's own `design` provider takes new mentions.
  bb.ui.registerMentionProvider(defineItemMention({
    id: "design",
    label: "Designs (old)",
    search: () => [],
    async resolve(id) {
      await ready();
      return { context: (await call("designs.mentionContext", { id })).context };
    },
  }));

  bb.cli.register({
    name: "design",
    summary: "Copy your designs into Studio (designs are built into Studio now)",
    commands: [{ name: "migrate", summary: "Copy every design and saved style into Studio, then report", usage: "bb design migrate" }],
    async run(argv) {
      if (argv[0] !== "migrate") {
        return { exitCode: 1, stderr: "Designs are built into Studio now: use `bb studio designs <list|show|html|rename|delete>`.\nThis plugin only copies your old designs into Studio: bb design migrate\n" };
      }
      try {
        const result = await runMigration();
        const skipped = result.skipped.length
          ? `Skipped ${result.skipped.length} that can't be copied, kept here as they were:\n${result.skipped.map((each) => `  ${each.id}: ${each.reason}`).join("\n")}\n`
          : "";
        return { exitCode: 0, stdout: `${skipped}${result.copied} of ${result.total} designs and saved styles are in Studio. Migration complete.\n` };
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
        bb.log.warn(`Copying designs into Studio will retry in ${Math.round(delay / 1000)}s: ${String(error)}`);
        attempt(Math.min(delay * 2, MAX_RETRY_MS));
      });
    }, delay);
  };
  bb.onDispose(() => { disposed = true; clearTimeout(timer); });
  attempt(FIRST_RETRY_MS);
}
