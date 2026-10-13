// Dashboards, built into Studio: live tiles, charts, tables and feeds on a
// responsive grid, edited by the user and their agents.
//
// A dashboard is widgets plus a layout per breakpoint (src/dashboards/ops.ts
// edits both). Each widget reads static data, a URL the server fetches, a
// shell command the user approved, or data an agent pushes; the last good
// value is kept with its time and error (server/refresh.ts). Custom widgets
// are sandboxed HTML from a library or the widget itself.
//
// A new kind, not a merged add-on: items are `dashboards:<id>` and open at
// /plugins/studio/studio/dashboards/<id>.
import { studioSchemas } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { createChangeBus, defineItemMention, studioServices, type BackupHandlers, type StudioProviderHandlers } from "@bb-studio/kit/server";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { homedir, hostname } from "node:os";
import { z } from "zod";
import { rpcContract } from "./contract";
import { acceptLayouts, applyOps } from "./ops";
import { ApprovalNonces } from "./server/approvals";
import { createDashboardBackup } from "./server/backup";
import { dashboardProvider } from "./server/provider";
import { isApproved, Refresher } from "./server/refresh";
import { decodeBody, fetchUrl, keepValue, runScript, scriptHash } from "./server/sources";
import { DashboardStore, parseDoc, type Actor, type DashboardRow } from "./server/store";
import { buildView, dataView, displayName, summary, toMeta, typeView } from "./server/view";
import {
  DASHBOARD_UPDATE_TYPE,
  DATA_UPDATE_TYPE,
  dashboardHref,
  jsonBytes,
  LIMITS,
  opSchema,
  OPS_HELP,
  PLUGIN_ID,
  REALTIME_CHANNEL,
  WIDGET_TYPES,
  WIDGETS,
  type Op,
} from "./shared";

/** Available in every agent session while dashboards are on. */
export const DASHBOARD_TOOLS = ["dashboard_create", "dashboard_list", "dashboard_read", "dashboard_edit", "widget_define", "widget_set_data"];

export const DASHBOARDS_USAGE = [
  "usage: bb studio dashboards <command>",
  "  list                                   List dashboards",
  "  show <id>                              Print a dashboard's widgets and data",
  "  set-data <id> <widget-id> <json>       Push data to a widget with a push source",
].join("\n");

const TICK_MS = 15_000;

export interface BuiltinDashboards {
  store: DashboardStore;
  provider: StudioProviderHandlers;
  backup: BackupHandlers;
  cli(argv: string[]): Promise<{ exitCode: number; stdout?: string; stderr?: string }>;
  /** Whether the kind is on (Setup → Kinds); off, nothing refreshes. */
  setEnabled(enabled: () => boolean): void;
  dispose(): void;
}

const widgetTypeLines = () => WIDGET_TYPES.map((type) => `- ${type}: ${WIDGETS[type].description} Data: ${WIDGETS[type].data}. Options: ${WIDGETS[type].options}.`).join("\n");

/** Registers dashboards' RPC, agent tools, mention provider and refresh loop on Studio. Studio has run the migrations. */
export function registerDashboards(bb: BbPluginApi, db: Database.Database, options: { now?: () => number; fetch?: typeof fetch; tickMs?: number | null } = {}): BuiltinDashboards {
  const now = options.now ?? Date.now;
  const store = new DashboardStore(db, now);
  const services = studioServices(bb.sdk);
  const studio = studioSchemas(z);
  const changeBus = createChangeBus({ bb, channel: REALTIME_CHANNEL, pluginId: PLUGIN_ID, schemas: studio, event: (id, updatedAt: number) => ({ type: DASHBOARD_UPDATE_TYPE, dashboardId: id, updatedAt }), delayMs: 1000 });
  const changed = (id: string) => changeBus.changed(id, store.get(id)?.updated_at ?? now());
  const dataChanged = (dashboardId: string, widgetIds: string[]) => {
    try { bb.realtime.publish(REALTIME_CHANNEL, { type: DATA_UPDATE_TYPE, dashboardId, widgetIds }); } catch { /* clients refetch on open */ }
  };

  let enabled = () => true;
  const refresher = new Refresher({
    store,
    now,
    enabled: () => enabled(),
    fetchUrl: async (source) => decodeBody(await fetchUrl(source.url ?? "", { fetch: options.fetch as never }), source.format ?? "auto"),
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
      store.write(id, result.doc, by, by === "agent" ? `Agent: ${label}` : label);
      for (const widgetId of result.sourceChanged) store.clearData(id, widgetId);
      for (const widgetId of new Set([...result.sourceChanged, ...result.added])) {
        const widget = result.doc.widgets.find((each) => each.id === widgetId);
        if (widget?.source.kind === "script") store.propose(id, widgetId, scriptHash(widget.source), by, threadId ?? null);
      }
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
        try {
          title = ((await bb.sdk.threads.get({ threadId: proposal.thread_id })) as { title?: string | null }).title?.trim() || null;
        } catch { /* a deleted thread: the dialog says "an agent" */ }
      }
      // Read the revision after the await, so a nonce never outlives an edit it didn't see.
      const issued = nonces.issue({ dashboardId: id, widgetId, sha256, revision: mustGet(id).updated_at });
      const current = store.doc(id).widgets.find((each) => each.id === widgetId);
      if (current?.source.kind !== "script" || scriptHash(current.source) !== sha256) {
        nonces.cancel(issued.nonce);
        throw new Error("The command changed while the dialog opened. Try again.");
      }
      return {
        prompt: {
          ...issued,
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
        },
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
      store.revoke(mustGet(id).id, widgetId);
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
      changed(id);
      return { dashboard: buildView(store, mustGet(id)) };
    },
    "dashboards.widgetTypes"() {
      return { types: store.types().map(typeView) };
    },
    "dashboards.saveWidgetType"({ id, name, description, html, defaultOptions }) {
      if (jsonBytes(html) > LIMITS.htmlBytes) throw new Error(`HTML is over ${LIMITS.htmlBytes / 1024} KB.`);
      const type = store.saveType({ id, name, description: description ?? "", html, defaultOptions: defaultOptions ?? {}, sampleData: undefined, by: "user" });
      for (const user of store.typeUsers(type.id)) changed(user);
      return { type: typeView(type) };
    },
    "dashboards.deleteWidgetType"({ id }) {
      const users = store.typeUsers(id);
      if (users.length) throw new Error(`Widgets on ${users.length} dashboard(s) use this type. Remove them first.`);
      return { ok: store.deleteType(id) };
    },
  });

  // ---------------------------------------------------------------------
  // Agent tools.

  const created = (id: string, threadId: string) => void services.created({ pluginId: PLUGIN_ID, id }, threadId).catch(() => {});
  const edited = (id: string, threadId: string) => {
    const at = now();
    void services.linkThread({ threadId, ref: { pluginId: PLUGIN_ID, id }, role: "edited", state: "working", createdAt: at, updatedAt: at, metadata: {} }).catch(() => {});
  };
  const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
  const link = (row: DashboardRow) => `[${displayName(row).replace(/[[\]]/g, "")}](${dashboardHref(row.id)})`;
  const scriptNote = (id: string) => {
    const waiting = store.doc(id).widgets.filter((widget) => widget.source.kind === "script" && !isApproved(store, id, widget));
    return waiting.length ? `\n${waiting.length} script widget(s) (${waiting.map((widget) => widget.id).join(", ")}) wait for the user to approve the exact command in the dashboard. You can't approve them; tell the user what each command does.` : "";
  };
  const opsParam = z.array(opSchema).min(1).max(100);

  bb.agents.registerTool({
    name: "dashboard_create",
    description: `Create a Studio dashboard: live stat tiles, charts, tables, feeds and custom widgets on a responsive grid. Pass widgets as add ops to fill it in one call. Widget types:\n${widgetTypeLines()}\nData sources (source): {kind:"static", data}, {kind:"url", url, format?: auto|json|rss, intervalSec? (min 60), select?}, {kind:"script", command, cwd?, intervalSec? (min 300), select?} (runs on the BB host only after the user approves the exact command), {kind:"push"} (send data with widget_set_data), {kind:"none"}.`,
    parameters: z.object({ name: z.string().trim().min(1).max(LIMITS.name), widgets: z.array(opSchema.extend({ op: z.literal("add").default("add") })).max(LIMITS.widgets).optional() }),
    execute({ name, widgets }, toolCtx) {
      const row = store.create({ name, projectId: toolCtx.projectId ?? null, by: "agent" });
      let results: string[] = [];
      if (widgets?.length) {
        try {
          const result = edit(row.id, widgets.map((op) => ({ ...op, op: "add" as const })), "agent", undefined, toolCtx.threadId);
          results = result.results;
        } catch (error) {
          store.delete(row.id);
          return fail(`Nothing was created: ${errorMessage(error)}`);
        }
      }
      changed(row.id);
      void refresher.tick(row.id).catch(() => {});
      if (toolCtx.threadId) created(row.id, toolCtx.threadId);
      return [`Created dashboard "${name}" (id ${row.id}). Link: ${link(row)}`, ...results, scriptNote(row.id)].filter(Boolean).join("\n");
    },
  });

  bb.agents.registerTool({
    name: "dashboard_list",
    description: "List the user's Studio dashboards: id, name, widget count, last update and link.",
    parameters: z.object({}),
    execute() {
      const rows = store.list();
      if (!rows.length) return "No dashboards yet. Make one with dashboard_create.";
      return `Dashboards:\n${rows.map((row) => `- ${displayName(row)} (id ${row.id}) — ${store.widgetCount(row.id)} widget(s), updated ${new Date(row.updated_at).toISOString()}, link ${dashboardHref(row.id)}`).join("\n")}`;
    },
  });

  bb.agents.registerTool({
    name: "dashboard_read",
    description: "Read a dashboard: each widget's id, type, title, position, data source and its current data or error, with the widgets as JSON for editing. Read it right before dashboard_edit: the user may have moved or changed widgets.",
    parameters: z.object({ dashboardId: z.string().min(1).max(200) }),
    execute({ dashboardId }) {
      const row = store.get(dashboardId);
      if (!row) return fail(`Dashboard ${dashboardId} not found.`);
      return summary(store, row, now());
    },
  });

  bb.agents.registerTool({
    name: "dashboard_edit",
    description: `Edit a dashboard the user may have open; their view updates live. All ops apply, or none do. Ops:\n${OPS_HELP}\nSee dashboard_create for widget types and data sources. Custom widgets: type "custom" with customType (a library type from widget_define) or html (this widget only).`,
    parameters: z.object({ dashboardId: z.string().min(1).max(200), ops: opsParam }),
    execute({ dashboardId, ops }, toolCtx) {
      if (!store.get(dashboardId)) return fail(`Dashboard ${dashboardId} not found.`);
      let result;
      try {
        result = edit(dashboardId, ops, "agent", undefined, toolCtx.threadId);
      } catch (error) {
        return fail(`Nothing changed: ${errorMessage(error)}`);
      }
      afterEdit(dashboardId, result);
      if (toolCtx.threadId) edited(dashboardId, toolCtx.threadId);
      return [`Updated ${link(mustGet(dashboardId))}:`, ...result.results.map((line) => `- ${line}`), scriptNote(dashboardId)].filter(Boolean).join("\n");
    },
  });

  bb.agents.registerTool({
    name: "widget_define",
    description: [
      "Add a custom widget type to the user's dashboard library (or update one, with its id), then use it with dashboard_edit {op:\"add\", type:\"custom\", customType:<id>}.",
      "html is a full widget: HTML, CSS and inline <script>. It runs in a sandboxed frame (scripts only, no same-origin, no network: connect-src 'none'; images only from data: URLs), so it can't fetch anything; data comes from the widget's source.",
      "In the frame, window.bbWidget holds {data, options, theme: {mode: light|dark, colors: {foreground, background, muted, border, accent, series[]}}, size: {width, height}}; listen with window.addEventListener('bbwidget', e => render(e.detail)), which fires on load and every change.",
      "The frame fills its tile; to ask for a height, post parent.postMessage({type: 'bb-widget-height', height}, '*').",
      "Follow the theme's colors so it works in light and dark.",
    ].join(" "),
    parameters: z.object({
      id: z.string().max(100).optional(),
      name: z.string().trim().min(1).max(LIMITS.title),
      description: z.string().max(2000).optional(),
      html: z.string().min(1),
      defaultOptions: z.record(z.string(), z.unknown()).optional(),
      sampleData: z.unknown().optional(),
    }),
    execute({ id, name, description, html, defaultOptions, sampleData }) {
      if (jsonBytes(html) > LIMITS.htmlBytes) return fail(`html is over ${LIMITS.htmlBytes / 1024} KB.`);
      if (jsonBytes(defaultOptions ?? {}) > LIMITS.optionsBytes) return fail(`defaultOptions is over ${LIMITS.optionsBytes / 1024} KB.`);
      if (sampleData !== undefined && jsonBytes(sampleData) > LIMITS.staticBytes) return fail(`sampleData is over ${LIMITS.staticBytes / 1024} KB.`);
      try {
        const type = store.saveType({ id, name, description: description ?? "", html, defaultOptions: defaultOptions ?? {}, sampleData, by: "agent" });
        for (const user of store.typeUsers(type.id)) changed(user);
        return `${id ? "Updated" : "Added"} widget type "${type.name}" (id ${type.id}) in the library. Use it with dashboard_edit: {"op":"add","type":"custom","customType":"${type.id}"}.`;
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  });

  bb.agents.registerTool({
    name: "widget_set_data",
    description: "Push data to a dashboard widget whose source is {kind:\"push\"} (set it with dashboard_edit). The user's view updates live and shows when it was updated. Data shape per widget type is listed in dashboard_create. Max 512 KB.",
    parameters: z.object({ dashboardId: z.string().min(1).max(200), widgetId: z.string().min(1).max(100), data: z.unknown() }),
    execute({ dashboardId, widgetId, data }) {
      try {
        setData(dashboardId, widgetId, data);
        return `Set data on ${widgetId} of dashboard ${dashboardId}.`;
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  });

  // `@dashboard` in any composer: the agent receives its summary.
  bb.ui.registerMentionProvider(defineItemMention({
    id: "dashboard",
    label: "Dashboards",
    search({ query }) {
      const q = query.trim().toLowerCase();
      return store.list({ limit: 50 })
        .filter((row) => !q || displayName(row).toLowerCase().includes(q))
        .map((row) => ({ id: row.id, title: displayName(row), subtitle: `${store.widgetCount(row.id)} widgets` }));
    },
    resolve: (itemId) => {
      const row = store.get(itemId);
      if (!row) throw new Error(`Dashboard ${itemId} not found`);
      return { context: `${summary(store, row, now())}\nRead the latest with dashboard_read; change it with dashboard_edit.` };
    },
  }));

  async function cli(argv: string[]): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
    const [cmd, ...rest] = argv;
    switch (cmd) {
      case "list": {
        const rows = store.list();
        if (!rows.length) return { exitCode: 0, stdout: "No dashboards yet.\n" };
        return { exitCode: 0, stdout: `${rows.map((row) => `${row.id}\t${displayName(row)}\t${store.widgetCount(row.id)} widgets\t${new Date(row.updated_at).toISOString()}`).join("\n")}\n` };
      }
      case "show": {
        const row = rest[0] ? store.get(rest[0]) : null;
        if (!rest[0]) return { exitCode: 1, stderr: "usage: bb studio dashboards show <id>\n" };
        if (!row) return { exitCode: 1, stderr: `Dashboard ${rest[0]} not found\n` };
        return { exitCode: 0, stdout: `${summary(store, row, now())}\n` };
      }
      case "set-data": {
        const [id, widgetId, ...json] = rest;
        if (!id || !widgetId || !json.length) return { exitCode: 1, stderr: "usage: bb studio dashboards set-data <id> <widget-id> <json>\n" };
        let data: unknown;
        try { data = JSON.parse(json.join(" ")); } catch (error) { return { exitCode: 1, stderr: `Not JSON: ${errorMessage(error)}\n` }; }
        try {
          setData(id, widgetId, data);
          return { exitCode: 0, stdout: `set ${widgetId}\n` };
        } catch (error) {
          return { exitCode: 1, stderr: `${errorMessage(error)}\n` };
        }
      }
      default:
        return { exitCode: 1, stderr: `${DASHBOARDS_USAGE}\n` };
    }
  }

  const tickMs = options.tickMs === undefined ? TICK_MS : options.tickMs;
  const timer = tickMs === null ? null : setInterval(() => void refresher.tick().catch((error) => bb.log.warn(`Dashboard refresh failed: ${errorMessage(error)}`)), tickMs);
  timer?.unref?.();

  return {
    store,
    provider: dashboardProvider({ store, changed, removed: changed }),
    backup: createDashboardBackup({ db, store, changed }),
    cli,
    setEnabled: (next) => { enabled = next; },
    dispose: () => {
      if (timer) clearInterval(timer);
      changeBus.dispose();
    },
  };
}

export { buildView };
