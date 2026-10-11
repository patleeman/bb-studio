// Studio Artifacts (plugin id `artifacts`), last release: the upgrade bridge.
//
// Artifacts are built into Studio now (packages/bb-studio/src/artifacts).
// BB keeps a plugin's database per plugin id, so this release copies the old
// rows into Studio (src/migrate.ts) and forwards what older clients still
// call here. It registers no UI, agent tools or skill: Studio has those, under
// the same names, and BB refuses a tool name two plugins register.
//
// - On start, and until one pass completes, it copies into Studio, retrying
//   with backoff while Studio is missing, off or starting.
// - `bb artifacts migrate` runs the copy now and reports it.
// - `migrationStatus` tells Studio's Setup page whether it can be removed.
// - Old RPCs (iOS builds from before the merge) and old `@artifact` mention
//   pills forward to Studio once the copy is complete, and the old content
//   URL serves bytes Studio holds.
import { MAX_ARTIFACT_BYTES, bridgeContract, bridgeStatusContract, rpcContract, type MigrationStatus } from "@bb-studio/kit/artifacts-contract";
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

/** The old method names: Studio's `artifacts.<name>` without the prefix. */
export const LEGACY_METHODS = Object.keys(rpcContract).map((name) => name.slice("artifacts.".length));
/** The old plugin's client methods, forwarded to Studio; iOS falls back to them for one release. */
export const legacyContract = defineRpcContract(Object.fromEntries(Object.entries(rpcContract).map(([name, spec]) => [name.slice("artifacts.".length), spec])) as {
  [K in keyof typeof rpcContract as K extends `artifacts.${infer Name}` ? Name : never]: (typeof rpcContract)[K];
});

/** What's safe to show inline from the old content URL; anything else downloads. */
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|audio\/|video\/|application\/pdf$)/;

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const call = <M extends Method>(method: M, input: z.input<Contract[M]["input"]>): Promise<z.output<Contract[M]["output"]>> => {
    const spec = ((rpcContract as Record<string, unknown>)[method] ?? (bridgeContract as Record<string, unknown>)[method]) as Contract[M];
    return bb.sdk.plugins.callRpc({
      pluginId: STUDIO_PLUGIN_ID, method, input: input as never,
      outputSchema: spec.output as unknown as z.ZodType<z.output<Contract[M]["output"]>>, signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  };
  const studio: StudioImport = {
    missingBlobs: async (sha256) => (await call("artifacts.missingBlobs", { sha256 })).missing,
    importBlob: async (sha256, bytes) => { await call("artifacts.importBlob", { sha256, bytes: bytes.toString("base64") }); },
    importRows: (artifacts) => call("artifacts.importRows", { artifacts }),
  };

  let status: MigrationStatus = { complete: false, total: (db.prepare("SELECT COUNT(*) AS n FROM artifacts").get() as { n: number }).n, copied: 0, skipped: [], error: null };
  let running: Promise<MigrationStatus> | null = null;
  const runMigration = () => running ??= migrate(db, studio, bb.storage.kv)
    .then((result) => {
      status = { ...result, error: null };
      if (result.skipped.length) bb.log.warn(`Skipped ${result.skipped.length} artifacts that can't be copied (kept here): ${result.skipped.map((each) => `${each.id} (${each.reason})`).join(", ")}`);
      return status;
    }, (error: unknown) => {
      status = { ...status, error: error instanceof Error ? error.message : String(error) };
      throw error;
    })
    .finally(() => { running = null; });
  /** Forwarded calls wait for a complete copy, so they never miss an artifact. */
  const ready = async () => { if (!status.complete) await runMigration(); };

  bb.rpc.register(bridgeStatusContract, { migrationStatus: () => status });
  bb.rpc.register(legacyContract, Object.fromEntries(LEGACY_METHODS.map((name) => [name, async (input: unknown) => {
    await ready();
    return call(`artifacts.${name}` as Method, input as never);
  }])) as never);

  // The old content URL, for clients from before the merge. Studio serves the
  // real thing at /api/v1/plugins/studio/http/artifacts/content.
  bb.http.route("GET", "/content", async (context) => {
    const id = context.req.query("artifact") ?? "";
    const versionId = context.req.query("version") ?? "";
    if (!id || !versionId) return context.text("Not found", 404);
    await ready();
    const [{ versions }, { bytes }] = await Promise.all([call("artifacts.get", { id }), call("artifacts.versionBytes", { id, versionId })]);
    const version = versions.find((each) => each.id === versionId);
    if (!version || bytes === null) return context.text("Not found", 404);
    const body = Buffer.from(bytes, "base64");
    if (body.byteLength > MAX_ARTIFACT_BYTES) return context.text("Too large", 413);
    const inline = INLINE.test(version.mime) && context.req.query("download") !== "1";
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": inline ? version.mime : "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(version.name)}`,
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  });

  // `@artifact` pills in threads from before the merge name this plugin;
  // Studio's own `artifact` provider takes new mentions.
  bb.ui.registerMentionProvider(defineItemMention({
    id: "artifact",
    label: "Artifacts (old)",
    search: () => [],
    async resolve(id) {
      await ready();
      return { context: (await call("artifacts.mentionContext", { id })).context };
    },
  }));

  bb.cli.register({
    name: "artifacts",
    summary: "Copy your artifacts into Studio (artifacts are built into Studio now)",
    commands: [{ name: "migrate", summary: "Copy every artifact into Studio, then report", usage: "bb artifacts migrate" }],
    async run(argv) {
      if (argv[0] !== "migrate") {
        return { exitCode: 1, stderr: "Artifacts are built into Studio now: use `bb studio artifacts <save|list|show|export|delete>`.\nThis plugin only copies your old artifacts into Studio: bb artifacts migrate\n" };
      }
      try {
        const result = await runMigration();
        const skipped = result.skipped.length
          ? `Skipped ${result.skipped.length} that can't be copied, kept here as they were:\n${result.skipped.map((each) => `  ${each.id}: ${each.reason}`).join("\n")}\n`
          : "";
        return { exitCode: 0, stdout: `${skipped}${result.copied} of ${result.total} artifacts are in Studio. Migration complete.\n` };
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
        bb.log.warn(`Copying artifacts into Studio will retry in ${Math.round(delay / 1000)}s: ${String(error)}`);
        attempt(Math.min(delay * 2, MAX_RETRY_MS));
      });
    }, delay);
  };
  bb.onDispose(() => { disposed = true; clearTimeout(timer); });
  attempt(FIRST_RETRY_MS);
}
