// Studio Draw (plugin id `excalidraw`), last release: the upgrade bridge.
//
// Drawings are built into Studio now (packages/bb-studio/src/draw). BB keeps
// a plugin's database per plugin id, so this release copies the old rows into
// Studio (src/migrate.ts) and forwards what older clients still call here. It
// registers no UI, agent tools or skill: Studio has those, under the same
// names, and BB refuses a tool name two plugins register.
//
// - On start, and until one pass completes, it copies into Studio, retrying
//   with backoff while Studio is missing, off or starting.
// - `bb excalidraw migrate` runs the copy now and reports it.
// - `migrationStatus` tells Studio's Setup page whether it can be removed.
// - Old RPCs (iOS builds and Pages from before the merge) and old `@drawing`
//   mention pills forward to Studio once the copy is complete, and the old
//   thumbnail URL serves Studio's thumbnail.
import { bridgeContract, bridgeStatusContract, rpcContract, type MigrationStatus } from "@bb-studio/kit/draw-contract";
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

/** The old method names: Studio's `drawings.<name>` without the prefix. */
export const LEGACY_METHODS = Object.keys(rpcContract).map((name) => name.slice("drawings.".length));
/** The old plugin's client methods, forwarded to Studio; iOS falls back to them for one release. */
export const legacyContract = defineRpcContract(Object.fromEntries(Object.entries(rpcContract).map(([name, spec]) => [name.slice("drawings.".length), spec])) as {
  [K in keyof typeof rpcContract as K extends `drawings.${infer Name}` ? Name : never]: (typeof rpcContract)[K];
});

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
  const studio: StudioImport = { importRows: (drawings) => call("drawings.importRows", { drawings }) };

  let status: MigrationStatus = { complete: false, total: (db.prepare("SELECT COUNT(*) AS n FROM drawings").get() as { n: number }).n, copied: 0, skipped: [], error: null };
  let running: Promise<MigrationStatus> | null = null;
  const runMigration = () => running ??= migrate(db, studio, bb.storage.kv)
    .then((result) => {
      status = { ...result, error: null };
      if (result.skipped.length) bb.log.warn(`Skipped ${result.skipped.length} drawings that can't be copied (kept here): ${result.skipped.map((each) => `${each.id} (${each.reason})`).join(", ")}`);
      return status;
    }, (error: unknown) => {
      status = { ...status, error: error instanceof Error ? error.message : String(error) };
      throw error;
    })
    .finally(() => { running = null; });
  /** Forwarded calls wait for a complete copy, so they never miss a drawing. */
  const ready = async () => { if (!status.complete) await runMigration(); };

  bb.rpc.register(bridgeStatusContract, { migrationStatus: () => status });
  // pickDrawing waits for the user to pick, up to five minutes.
  bb.rpc.register(legacyContract, Object.fromEntries(LEGACY_METHODS.map((name) => [name, async (input: unknown) => {
    await ready();
    return call(`drawings.${name}` as Method, input as never, name === "pickDrawing" ? 330_000 : CALL_TIMEOUT_MS);
  }])) as never);

  // The old thumbnail URL, for clients from before the merge. Studio serves
  // the real thing at /api/v1/plugins/studio/http/drawings/thumbnail.
  bb.http.route("GET", "/thumbnail", async (context) => {
    const id = context.req.query("drawing") ?? "";
    if (!id) return context.text("Not found", 404);
    await ready();
    const { svg } = await call("drawings.thumbnail", { id });
    if (!svg) return context.text("Not found", 404);
    return new Response(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        // The SVG is built from scene data; never let it run anything.
        "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  });

  // `@drawing` pills in threads from before the merge name this plugin;
  // Studio's own `drawing` provider takes new mentions.
  bb.ui.registerMentionProvider(defineItemMention({
    id: "drawing",
    label: "Drawings (old)",
    search: () => [],
    async resolve(id) {
      await ready();
      return { context: (await call("drawings.mentionContext", { id })).context };
    },
  }));

  bb.cli.register({
    name: "excalidraw",
    summary: "Copy your drawings into Studio (drawings are built into Studio now)",
    commands: [{ name: "migrate", summary: "Copy every drawing into Studio, then report", usage: "bb excalidraw migrate" }],
    async run(argv) {
      if (argv[0] !== "migrate") {
        return { exitCode: 1, stderr: "Drawings are built into Studio now: use `bb studio drawings <list|create|show|rename|delete|merge|remove-elements>`.\nThis plugin only copies your old drawings into Studio: bb excalidraw migrate\n" };
      }
      try {
        const result = await runMigration();
        const skipped = result.skipped.length
          ? `Skipped ${result.skipped.length} that can't be copied, kept here as they were:\n${result.skipped.map((each) => `  ${each.id}: ${each.reason}`).join("\n")}\n`
          : "";
        return { exitCode: 0, stdout: `${skipped}${result.copied} of ${result.total} drawings are in Studio. Migration complete.\n` };
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
        bb.log.warn(`Copying drawings into Studio will retry in ${Math.round(delay / 1000)}s: ${String(error)}`);
        attempt(Math.min(delay * 2, MAX_RETRY_MS));
      });
    }, delay);
  };
  bb.onDispose(() => { disposed = true; clearTimeout(timer); });
  attempt(FIRST_RETRY_MS);
}
