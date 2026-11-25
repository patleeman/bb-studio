import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { join } from "node:path";
import type { registerArtifacts } from "../artifacts/server";
import { registerBackup } from "../backup/register";
import { BackupService } from "../backup/service";
import { studioDataBackup } from "../backup/studio-data";
import type { ChangeLog } from "../changes";
import type { registerDashboards } from "../dashboards/server";
import type { registerDesign } from "../design/server";
import type { registerDraw } from "../draw/server";
import type { HealthMonitor } from "../health";
import { errorText } from "../hub";
import type { ItemIndex } from "../item-index";
import { BUILTIN_KINDS, builtinOn, frontendState, kindRowViews, rowKinds, type KindRoute, type KindSettingsStore } from "../kinds";
import { kindsContract, type KindsState } from "../kinds-contract";
import { STUDIO_PLUGIN_ID, STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import type { registerMinis } from "../minis/server";
import type { registerPages } from "../pages/server";
import { importReactionsSettings, REACTIONS_PLUGIN_ID, REACTIONS_SETTINGS_IMPORTED } from "../reactions/server";
import type { SearchIndex } from "../search-index";
import { SetupService } from "../setup";
import { setupContract } from "../setup-contract";
import type { registerTalk } from "../talk/server";
import { forestContract } from "../theme/forest/contract";
import { ForestWeather } from "../theme/forest/weather";
import { builtinOptionStores, readThemeOptions, themeOptionsContract, writeThemeOption } from "../theme/options-contract";
import { readPreview, readView, tonightContract } from "../theme/tonight/contract";

export interface PlatformRpcsDeps {
  bb: BbPluginApi;
  db: Database.Database;
  health: HealthMonitor;
  changes: ChangeLog;
  itemIndex: ItemIndex;
  searchIndex: SearchIndex;
  kindSettings: KindSettingsStore;
  refreshRoutes: () => Promise<KindRoute[]>;
  reactionsImport: Parameters<typeof importReactionsSettings>[0];
  pages: ReturnType<typeof registerPages>;
  artifacts: ReturnType<typeof registerArtifacts>;
  drawings: ReturnType<typeof registerDraw>;
  designs: ReturnType<typeof registerDesign>;
  recordings: Awaited<ReturnType<typeof registerTalk>>;
  dashboards: ReturnType<typeof registerDashboards>;
  minis: ReturnType<typeof registerMinis>;
}

/** Registers theme weather/sky/options, Setup, Setup → Kinds, and Backup RPCs. */
export function registerPlatformRpcs({
  bb,
  db,
  health,
  changes,
  itemIndex,
  searchIndex,
  kindSettings,
  refreshRoutes,
  reactionsImport,
  pages,
  artifacts,
  drawings,
  designs,
  recordings,
  dashboards,
  minis,
}: PlatformRpcsDeps): { forestWeather: ForestWeather; setup: SetupService; backups: BackupService } {
  const forestWeather = new ForestWeather({ kv: bb.storage.kv });
  bb.rpc.register(forestContract, {
    "theme.weather": ({ timeZone }) => forestWeather.sky(timeZone),
    "theme.weather.city": ({ city }) => forestWeather.setCity(city),
  });
  bb.rpc.register(tonightContract, {
    "theme.sky": async ({ timeZone }) => ({ place: await forestWeather.place(timeZone), previewAt: await readPreview(bb.storage.kv), view: await readView(bb.storage.kv) }),
  });
  const themeOptionStores = builtinOptionStores(bb.storage.kv);
  bb.rpc.register(themeOptionsContract, {
    "theme.options": ({ themeId }) => readThemeOptions(themeOptionStores, themeId),
    "theme.options.set": ({ themeId, id, value }) => writeThemeOption(themeOptionStores, themeId, id, value),
  });

  // BB Studio setup: add-ons, retired plugins and what to run; see src/setup.ts.
  const setup = new SetupService({
    sdk: bb.sdk,
    health: (maxAgeMs) => (maxAgeMs ? health.summary(maxAgeMs) : health.check()),
    // Setup's Retired plugins: Studio Reactions can go once its settings are copied.
    settingsCopied: async (pluginId) => {
      if (pluginId !== REACTIONS_PLUGIN_ID) return true;
      await importReactionsSettings(reactionsImport).catch(() => null);
      return Boolean(await bb.storage.kv.get(REACTIONS_SETTINGS_IMPORTED));
    },
  });
  bb.rpc.register(setupContract, {
    "setup.summary": ({ maxAgeMs }) => setup.summary(maxAgeMs),
    "setup.install": ({ pluginIds }) => setup.install(pluginIds),
    "setup.enable": ({ pluginId }) => setup.enable(pluginId),
    "setup.remove": ({ pluginId }) => setup.remove(pluginId),
  });

  // Setup → Kinds (src/kinds.ts). Turning a kind off or on, or choosing its
  // provider, applies to Studio's lists, search and New menus at once, to
  // agents from their next session, and to thread tabs, composer entries and
  // reply cards after a window reload.
  const kindsState = async (): Promise<KindsState> => {
    const routes = await refreshRoutes();
    const settings = kindSettings.current;
    return {
      kinds: kindRowViews(routes, settings),
      frontend: frontendState(routes, settings),
    };
  };
  bb.rpc.register(kindsContract, {
    "kinds.state": () => kindsState(),
    "kinds.update": async ({ kind, on, use }) => {
      const pluginIds = rowKinds(kind).map((each) => BUILTIN_KINDS.find((builtin) => builtin.kind === each)!.pluginId);
      const before = pluginIds.map((pluginId) => builtinOn(kindSettings.current, pluginId));
      await kindSettings.update(kind, { on, use });
      for (const member of rowKinds(kind)) bb.log.info(`Studio kind ${member}: ${kindSettings.current.off.includes(member) ? "off" : "on"}, open and create with ${kindSettings.current.use[member] ?? "automatic"}.`);
      // Search drops an off kind's hits and indexes it again when it's back on.
      pluginIds.forEach((pluginId, index) => { if (before[index] !== builtinOn(kindSettings.current, pluginId)) void searchIndex.changed(pluginId).catch(() => {}); });
      changes.append(null);
      for (const pluginId of pluginIds) bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId });
      return kindsState();
    },
  });

  // Backup and restore of every Studio item (src/backup/, docs/backup.md).
  const threadExists = (threadId: string) => bb.sdk.threads.get({ threadId }).then((thread) => thread.deletedAt == null);
  const backups = new BackupService({
    dataDir: bb.server.experimental_dataDir,
    sdk: bb.sdk,
    bbVersion: () => Promise.race([
      bb.sdk.system.version().then((version) => version.currentVersion),
      new Promise<null>((done) => setTimeout(() => done(null), 3000)),
    ]),
    studioData: studioDataBackup(db, {
      threadExists,
      changed: () => {
        // A backup carries no item index: restored rows index themselves (the triggers), and this checks them.
        try { itemIndex.heal(); } catch (error) { bb.log.warn(`Item index check after restore failed: ${errorText(error)}`); }
        changes.append(null);
        bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
        void searchIndex.rebuild().catch((error) => bb.log.warn(`Reindex after restore failed: ${errorText(error)}`));
      },
    }),
    builtins: {
      pages: { name: "Studio Pages", handlers: pages.backup },
      artifacts: { name: "Studio Artifacts", handlers: artifacts.backup },
      excalidraw: { name: "Studio Draw", handlers: drawings.backup },
      design: { name: "Studio Design", handlers: designs.backup },
      talk: { name: "Studio Talk", handlers: recordings.backup },
      dashboards: { name: "Studio Dashboards", handlers: dashboards.backup },
      minis: { name: "Studio Apps", handlers: minis.backup },
    },
  });
  registerBackup(bb, backups, join(bb.server.experimental_dataDir, "plugins", STUDIO_PLUGIN_ID));

  return { forestWeather, setup, backups };
}
