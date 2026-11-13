import type { StudioChanged } from "../kit/server/core";
import { grantAfterHostApproval, hostApproval } from "../kit/host-approval";
import { scriptApprovalDetail } from "./server/approval-detail";
// Dashboards, built into Studio: live tiles, charts, tables and feeds on a
// responsive grid, edited by the user and their agents.
//
// A dashboard is widgets plus a layout per breakpoint (src/dashboards/ops.ts
// edits both). Each widget reads static data, a URL the server fetches, a
// shell command the user approved, or data an agent pushes; the last good
// value is kept with its time and error (server/refresh.ts). Custom widgets
// are sandboxed HTML from a library or the widget itself.
import { readAvailable } from "../kit/server/read-available";
import { studioSchemas } from "../kit/contract";
import { errorMessage } from "../kit/format";
import { createChangeBus, type BackupHandlers } from "../kit/server/index";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { homedir, hostname } from "node:os";
import { z } from "zod";
import { rpcContract } from "./contract";
import { acceptLayouts, applyOps } from "./ops";
import { ApprovalNonces } from "./server/approvals";
import { createDashboardBackup } from "./server/backup";
import { Refresher } from "./server/refresh";
import type { Resolve, Transport } from "../guarded-fetch";
import { decodeBody, fetchUrl, keepValue, runScript, scriptHash } from "./server/sources";
import { DashboardStore, parseDoc, type Actor, type DashboardRow } from "./server/store";
import { buildView, dataView, toMeta, typeView } from "./server/view";
import {
  DASHBOARD_UPDATE_TYPE,
  DATA_UPDATE_TYPE,
  jsonBytes,
  LIMITS,
  PLUGIN_ID,
  REALTIME_CHANNEL,
  type Op,
} from "./shared";

const TICK_MS = 15_000;

export interface BuiltinDashboards {
  store: DashboardStore;
  backup: BackupHandlers;
  dispose(): void;
}

/** Registers dashboards' RPC and refresh loop on Studio. Studio has run the migrations. */
export function registerDashboards(bb: BbPluginApi, db: Database.Database, notify: StudioChanged, options: { now?: () => number; transport?: Transport; resolve?: Resolve; tickMs?: number | null } = {}): BuiltinDashboards {
  const now = options.now ?? Date.now;
  const store = new DashboardStore(db, now, (id, widgetIds) => refresher.invalidate(id, widgetIds));
  const studio = studioSchemas(z);
  const changeBus = createChangeBus({ bb, notify, channel: REALTIME_CHANNEL, pluginId: PLUGIN_ID, schemas: studio, event: (id, updatedAt: number) => ({ type: DASHBOARD_UPDATE_TYPE, dashboardId: id, updatedAt }), delayMs: 1000 });
  const changed = (id: string) => changeBus.changed(id, store.get(id)?.updated_at ?? now());
  const dataChanged = (dashboardId: string, widgetIds: string[]) => {
    try { bb.realtime.publish(REALTIME_CHANNEL, { type: DATA_UPDATE_TYPE, dashboardId, widgetIds }); } catch { /* clients refetch on open */ }
  };

  const refresher = new Refresher({
    store,
    now,
    enabled: () => true,
    fetchUrl: async (source) => decodeBody(await fetchUrl(source.url ?? "", { transport: options.transport, resolve: options.resolve }), source.format ?? "auto"),
    runScript: (source) => runScript(source),
    changed: dataChanged,
    log: (message) => bb.log.info(message),
  });

  const mustGet = (id: string): DashboardRow => {
    const row = store.get(id);
    if (!row) throw new Error(`Dashboard ${id} not found.`);
    return row;
  };
  const ctx = { newId: () => `w_${randomBytes(6).toString("hex")}`, hasType: (typeId: string) => store.type(typeId) !== null };

  const nonces = new ApprovalNonces(now);

  /** Applies ops and saves, as one step. Records who wrote each new script command. */
  function edit(id: string, ops: readonly Op[], by: Actor, expectedUpdatedAt?: number, threadId?: string) {
    return db.transaction(() => {
      const row = mustGet(id);
      if (expectedUpdatedAt !== undefined && row.updated_at !== expectedUpdatedAt) throw new Error("The dashboard changed since you loaded it. Reload and try again.");
      const result = applyOps(store.doc(id), ops, ctx);
      const label = ops.length === 1 ? `${ops[0]!.op[0]!.toUpperCase()}${ops[0]!.op.slice(1)} widget` : `${ops.length} edits`;
      store.write(id, result.doc, by, by === "agent" ? `Agent: ${label}` : label, threadId ?? null);
      return result;
    }).immediate();
  }

  function afterEdit(id: string, result: { sourceChanged: string[]; added: string[] }) {
    changed(id);
    if (result.sourceChanged.length || result.added.length) void refresher.tick(id).catch(() => {});
  }

  function setData(id: string, widgetId: string, data: unknown) {
    const doc = store.doc(mustGet(id).id);
    const widget = doc.widgets.find((each) => each.id === widgetId);
    if (!widget) throw new Error(`No widget ${widgetId} on dashboard ${id}.`);
    if (widget.source.kind !== "push") throw new Error(`Widget ${widgetId} reads ${widget.source.kind === "none" ? "no data" : `a ${widget.source.kind} source`}; set its source to {"kind":"push"} with dashboard_edit first.`);
    if (jsonBytes(data) > LIMITS.pushBytes) throw new Error(`Pushed data is over ${LIMITS.pushBytes / 1024} KB.`);
    store.setValue(id, widgetId, keepValue(data ?? null, widget.source.select), now());
    dataChanged(id, [widgetId]);
    return dataView(store, id, widget, store.dataFor(id, widgetId));
  }

  bb.rpc.register(rpcContract, {
    "dashboards.list"() {
      return { dashboards: store.list().map((row) => toMeta(row, store.widgetCount(row.id))) };
    },
    "dashboards.get"({ id }) {
      const row = store.get(id);
      return { dashboard: row ? buildView(store, row) : null };
    },
    "dashboards.create"({ name, projectId }) {
      const row = store.create({ name: name?.trim() ?? "", projectId: projectId ?? null, by: "user" });
      changed(row.id);
      return { dashboard: toMeta(row, 0) };
    },
    "dashboards.rename"({ id, name }) {
      const updatedAt = store.rename(mustGet(id).id, name, "user");
      changed(id);
      return { ok: true, updatedAt };
    },
    "dashboards.delete"({ id }) {
      nonces.forget(id);
      if (store.delete(id)) changed(id);
      return { ok: true };
    },
    "dashboards.edit"({ id, ops, expectedUpdatedAt }) {
      const result = edit(id, ops, "user", expectedUpdatedAt);
      afterEdit(id, result);
      return { dashboard: buildView(store, mustGet(id)), results: result.results };
    },
    "dashboards.saveLayout"({ id, layouts }) {
      const updatedAt = db.transaction(() => {
        const row = mustGet(id);
        const doc = acceptLayouts(store.doc(row.id), layouts);
        return store.write(id, doc, "user", "Layout");
      }).immediate();
      changed(id);
      return { updatedAt };
    },
    "dashboards.view"({ id, clientId, leave }) {
      if (leave) {
        refresher.leave(id, clientId);
        return { ok: true };
      }
      if (!store.get(id)) return { ok: false };
      const fresh = !refresher.viewed(id);
      refresher.view(id, clientId);
      // Opening a dashboard refreshes what's stale now, not at the next tick.
      if (fresh) void refresher.tick(id).catch(() => {});
      return { ok: true };
    },
    async "dashboards.refresh"({ id, widgetId }) {
      mustGet(id);
      const refreshed = await refresher.refreshNow(id, widgetId);
      const row = mustGet(id);
      return { refreshed, data: buildView(store, row).data };
    },
    "dashboards.setData"({ id, widgetId, data }) {
      return { data: setData(id, widgetId, data) };
    },
    async "dashboards.requestApproval"({ id, widgetId }, context) {
      // The approval dialog opens with this. Plugins can't open one, there's
      // no agent tool for it, and it needs a BB window showing the dashboard.
      if (context?.experimental_caller?.kind === "plugin") throw new Error("Only the user can approve a script.");
      const row = mustGet(id);
      const widget = store.doc(row.id).widgets.find((each) => each.id === widgetId);
      if (widget?.source.kind !== "script") throw new Error("That widget doesn't run a script.");
      if (!refresher.viewed(id)) throw new Error("Open the dashboard in BB to approve its script.");
      const sha256 = scriptHash(widget.source);
      const proposal = store.proposal(id, widgetId, sha256);
      let title: string | null = null;
      if (proposal?.thread_id) {
        const thread = await readAvailable(() => bb.sdk.threads.get({ threadId: proposal.thread_id! }));
        if (thread.status === "unavailable") throw thread.error;
        if (thread.status === "ok") title = thread.value.title?.trim() || null;
      }
      const details = {
        sha256,
        command: widget.source.command ?? "",
        cwd: widget.source.cwd || homedir(),
        cwdIsHome: !widget.source.cwd,
        host: hostname().replace(/\.local$/i, ""),
        intervalSec: widget.source.intervalSec ?? LIMITS.scriptMinIntervalSec,
        backgroundSec: Math.round(LIMITS.backgroundMs / 1000),
        timeoutSec: Math.round(LIMITS.scriptTimeoutMs / 1000),
        maxOutputBytes: LIMITS.scriptBytes,
        proposedBy: proposal ? { actor: proposal.actor, threadId: proposal.thread_id, threadTitle: title, at: proposal.proposed_at } : null,
      };
      // On a BB with its own approval dialog there is one dialog, BB's, with the same details; only a person can
      // answer it. Studio's dialog and its one-time nonce are for a BB without one.
      const askHost = hostApproval(bb);
      if (askHost) {
        grantAfterHostApproval(askHost, {
          title: "Let this dashboard run a command?",
          message: details.command.slice(0, 380),
          detail: scriptApprovalDetail(details),
          confirmLabel: "Allow",
        }, () => {
          const now = store.doc(mustGet(id).id).widgets.find((each) => each.id === widgetId);
          if (now?.source.kind !== "script" || scriptHash(now.source) !== sha256) throw new Error("The command changed before the approval was answered. Ask again.");
          store.approve(id, widgetId, sha256, now.source.command ?? "", now.source.cwd ?? null);
          changed(id);
          void refresher.refreshNow(id, widgetId).catch(() => {});
        }, (message) => bb.log.warn(`Dashboard script approval: ${message}`));
        return { prompt: { nonce: "host-approval-dialog", notBefore: 0, expiresAt: 0, ...details }, host: true };
      }
      // Read the revision after the await, so a nonce never outlives an edit it didn't see.
      const issued = nonces.issue({ dashboardId: id, widgetId, sha256, revision: mustGet(id).updated_at });
      const current = store.doc(id).widgets.find((each) => each.id === widgetId);
      if (current?.source.kind !== "script" || scriptHash(current.source) !== sha256) {
        nonces.cancel(issued.nonce);
        throw new Error("The command changed while the dialog opened. Try again.");
      }
      return {
        prompt: { ...issued, ...details },
      };
    },
    "dashboards.cancelApproval"({ nonce }) {
      nonces.cancel(nonce);
      return { ok: true };
    },
    "dashboards.approveScript"({ id, widgetId, sha256, nonce }, context) {
      // Only the approval dialog's Approve: it holds a nonce from
      // requestApproval for this command (server/approvals.ts).
      if (context?.experimental_caller?.kind === "plugin") throw new Error("Only the user can approve a script.");
      const row = mustGet(id);
      const widget = store.doc(row.id).widgets.find((each) => each.id === widgetId);
      if (widget?.source.kind !== "script") throw new Error("That widget doesn't run a script.");
      const current = scriptHash(widget.source);
      nonces.redeem(nonce, { dashboardId: id, widgetId, sha256, revision: row.updated_at });
      if (current !== sha256) throw new Error("The command changed since it was shown. Review the new command and approve it again.");
      store.approve(id, widgetId, current, widget.source.command ?? "", widget.source.cwd ?? null);
      changed(id);
      void refresher.refreshNow(id, widgetId).catch(() => {});
      return { ok: true };
    },
    "dashboards.revokeScript"({ id, widgetId }) {
      const row = mustGet(id);
      const widget = store.doc(row.id).widgets.find((each) => each.id === widgetId);
      // Revoking a command stops every widget on the dashboard that shares it.
      store.revoke(row.id, widgetId, widget?.source.kind === "script" ? scriptHash(widget.source) : undefined);
      changed(id);
      return { ok: true };
    },
    "dashboards.versions"({ id }) {
      mustGet(id);
      return {
        versions: store.versions(id).map((version) => ({
          id: version.id, createdAt: version.created_at, actor: version.actor, label: version.label,
          widgetCount: parseDoc(version.doc).widgets.length,
        })),
      };
    },
    "dashboards.restoreVersion"({ id, versionId }) {
      const version = store.version(mustGet(id).id, versionId);
      if (!version) throw new Error("That version is gone.");
      const doc = parseDoc(version.doc);
      db.transaction(() => {
        const checked = applyOps({ widgets: doc.widgets, layouts: doc.layouts }, [], { ...ctx, hasType: () => true }).doc;
        store.saveVersion(mustGet(id), "user", "Before restoring a version");
        store.write(id, checked, "user", "Restored a version");
      }).immediate();
      afterEdit(id, { sourceChanged: doc.widgets.map((widget) => widget.id), added: [] });
      return { dashboard: buildView(store, mustGet(id)) };
    },
    "dashboards.widgetTypes"() {
      return { types: store.types().map(typeView) };
    },
    "dashboards.saveWidgetType"({ id, name, description, html, defaultOptions }) {
      const type = store.saveType({ id, name, description, html, defaultOptions, by: "user" });
      for (const user of store.typeUsers(type.id)) changed(user);
      return { type: typeView(type) };
    },
    "dashboards.deleteWidgetType"({ id }) {
      const users = store.typeUsers(id);
      if (users.length) throw new Error(`Widgets on ${users.length} dashboard(s) use this type. Remove them first.`);
      return { ok: store.deleteType(id) };
    },
  });

  const tickMs = options.tickMs === undefined ? TICK_MS : options.tickMs;
  const timer = tickMs === null ? null : setInterval(() => void refresher.tick().catch((error) => bb.log.warn(`Dashboard refresh failed: ${errorMessage(error)}`)), tickMs);
  timer?.unref?.();

  return {
    store,
    backup: createDashboardBackup({ db, store, changed: (id) => { changed(id); void refresher.tick(id).catch(() => {}); } }),
    dispose: () => {
      if (timer) clearInterval(timer);
      changeBus.dispose();
    },
  };
}

export { buildView };
