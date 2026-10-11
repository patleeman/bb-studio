// Studio Talk (plugin id `talk`), last release: the upgrade bridge.
//
// Recording and dictation are built into Studio now
// (packages/bb-studio/src/talk). BB keeps a plugin's database, KV, settings
// and files per plugin id, so this release copies the old recordings, their
// audio, and the user's Talk settings and model choices into Studio
// (src/migrate.ts), and forwards what older clients still call here. It
// registers no UI, agent tools, commands or skill: Studio has those, under the
// same names, and BB refuses a tool name two plugins register.
//
// - On start, and until one pass completes, it copies into Studio, retrying
//   with backoff while Studio is missing, off or starting.
// - `bb talk migrate` runs the copy now and reports it.
// - `migrationStatus` tells Studio's Setup page whether it can be removed.
// - Old RPCs (iOS builds from before the merge, a browser tab still running
//   the old recorder) and old `@recordings` mention pills forward to Studio
//   once the copy is complete, and the old audio and transcript URLs redirect
//   to Studio's.
// - The audio stays in this plugin's folder; removing the plugin deletes it.
import { bridgeContract, bridgeStatusContract, modelPreferencesSchema, rpcContract, TALK_SETTINGS, type MigrationStatus, type ModelPreferences, type TalkSettings } from "@bb-studio/kit/talk-contract";
import { STUDIO_PLUGIN_ID } from "@bb-studio/kit/contract";
import { defineItemMention } from "@bb-studio/kit/server";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { MIGRATIONS, migrate, type StudioImport } from "./src/migrate";

const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 10 * 60_000;
const CALL_TIMEOUT_MS = 60_000;

type Contract = typeof rpcContract & typeof bridgeContract;
type Method = keyof Contract;

/** The old method names: Studio's `recordings.<name>` without the prefix. */
export const LEGACY_METHODS = Object.keys(rpcContract).map((name) => name.slice("recordings.".length));
/** The old plugin's client methods, forwarded to Studio; iOS falls back to them for one release. */
export const legacyContract = defineRpcContract(Object.fromEntries(Object.entries(rpcContract).map(([name, spec]) => [name.slice("recordings.".length), spec])) as {
  [K in keyof typeof rpcContract as K extends `recordings.${infer Name}` ? Name : never]: (typeof rpcContract)[K];
});

/** Where Studio serves what this plugin's HTTP routes used to. */
export const STUDIO_HTTP = "/api/v1/plugins/studio/http/recordings";

/**
 * Talk's settings, defined again only to read what the user had set; Studio
 * copies them once. They're on Studio's settings page now.
 */
const SETTINGS = Object.fromEntries(Object.entries(TALK_SETTINGS).map(([key, descriptor]) => [key, {
  ...descriptor,
  label: `${descriptor.label} (moved to Studio)`,
  description: "Talk is built into Studio: this setting is on Studio's settings page now, and `bb talk migrate` copied it there once. Changing it here does nothing.",
}])) as unknown as typeof TALK_SETTINGS;

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
    missingAudio: (files) => call("recordings.missingAudio", { files }),
    importAudio: (input) => call("recordings.importAudio", input),
    importRows: (recordings) => call("recordings.importRows", { recordings }),
    importSettings: (input) => call("recordings.importSettings", input),
  };

  // The Talk plugin kept its audio beside its database: <dataDir>/plugins/talk/audio.
  const main = (db.pragma("database_list") as { name: string; file: string }[]).find((entry) => entry.name === "main");
  const audioRoot = join(main?.file ? dirname(main.file) : bb.server.experimental_dataDir, "audio");
  /** What the user set in Talk: its settings, and its model choices (KV `model:<purpose>`). */
  const oldSettings = async (): Promise<{ settings: TalkSettings; models: Partial<ModelPreferences> }> => {
    const models: Partial<ModelPreferences> = {};
    for (const purpose of ["cleanup", "title", "summary"] as const) {
      const parsed = modelPreferencesSchema.shape[purpose].safeParse(await bb.storage.kv.get(`model:${purpose}`));
      if (parsed.success && parsed.data) models[purpose] = parsed.data;
    }
    return { settings: (await settings.get()) as TalkSettings, models };
  };

  const count = (db.prepare("SELECT COUNT(*) AS n FROM recordings").get() as { n: number }).n;
  let status: MigrationStatus = { complete: false, total: count, copied: 0, skipped: [], error: null };
  let running: Promise<MigrationStatus> | null = null;
  const runMigration = () => running ??= migrate(db, studio, bb.storage.kv, { audioRoot, settings: oldSettings })
    .then((result) => {
      status = { ...result, error: null };
      if (result.skipped.length) bb.log.warn(`Skipped ${result.skipped.length} recordings that can't be copied (kept here): ${result.skipped.map((each) => `${each.id} (${each.reason})`).join(", ")}`);
      return status;
    }, (error: unknown) => {
      status = { ...status, error: error instanceof Error ? error.message : String(error) };
      throw error;
    })
    .finally(() => { running = null; });
  /** Forwarded calls wait for a complete copy, so they never miss a recording. */
  const ready = async () => { if (!status.complete) await runMigration(); };

  bb.rpc.register(bridgeStatusContract, { migrationStatus: () => status });
  bb.rpc.register(legacyContract, Object.fromEntries(LEGACY_METHODS.map((name) => [name, async (input: unknown) => {
    await ready();
    return call(`recordings.${name}` as Method, input as never);
  }])) as never);

  // The old audio, transcript and download URLs, for clients and threads from
  // before the merge: the same query on Studio's routes, same origin.
  for (const route of ["audio", "transcript", "audio-export"]) {
    bb.http.route("GET", `/${route}`, async (context) => {
      await ready();
      const query = new URL(context.req.url).search;
      return context.redirect(`${STUDIO_HTTP}/${route}${query}`, 302);
    });
  }

  // `@recordings` pills in threads from before the merge name this plugin;
  // Studio's own `recordings` provider takes new mentions.
  bb.ui.registerMentionProvider(defineItemMention({
    id: "recordings",
    label: "Talk recordings (old)",
    search: () => [],
    async resolve(id) {
      await ready();
      return { context: (await call("recordings.mentionContext", { id })).context };
    },
  }));

  bb.cli.register({
    name: "talk",
    summary: "Copy your recordings into Studio (Talk is built into Studio now)",
    commands: [{ name: "migrate", summary: "Copy every recording, its audio, and your Talk settings into Studio, then report", usage: "bb talk migrate" }],
    async run(argv) {
      if (argv[0] !== "migrate") {
        return { exitCode: 1, stderr: "Talk is built into Studio now: use `bb studio recordings <list|show|transcript|notes>`.\nThis plugin only copies your old recordings into Studio: bb talk migrate\n" };
      }
      try {
        const result = await runMigration();
        const skipped = result.skipped.length
          ? `Skipped ${result.skipped.length} that can't be copied, kept here as they were:\n${result.skipped.map((each) => `  ${each.id}: ${each.reason}`).join("\n")}\n`
          : "";
        return { exitCode: 0, stdout: `${skipped}${result.copied} of ${result.total} recordings, with their audio, and your Talk settings are in Studio. Migration complete.\n` };
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
        bb.log.warn(`Copying recordings into Studio will retry in ${Math.round(delay / 1000)}s: ${String(error)}`);
        attempt(Math.min(delay * 2, MAX_RETRY_MS));
      });
    }, delay);
  };
  bb.onDispose(() => { disposed = true; clearTimeout(timer); });
  attempt(FIRST_RETRY_MS);
}
