import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { registerDashboards } from "../server";
import { DashboardStore, DASHBOARD_TABLES } from "../server/store";

/** An in-memory store with the dashboard tables. */
export function memoryStore(now: () => number = Date.now) {
  const db = new Database(":memory:");
  db.exec(DASHBOARD_TABLES);
  return { db, store: new DashboardStore(db, now) };
}

/** Studio on a fake host with only dashboards registered, no refresh timer. */
export function dashboardHost(options: { now?: () => number; fetch?: typeof fetch } = {}) {
  const host = createFakePluginHost({ pluginId: "studio", sdk: {
    plugins: { callRpc: async () => { throw new Error("not in this test"); } },
  } });
  const db = host.bb.storage.database();
  db.exec(DASHBOARD_TABLES);
  const dashboards = registerDashboards(host.bb, db, { ...options, tickMs: null });
  host.bb.onDispose(() => dashboards.dispose());
  return { ...host, dashboards };
}
