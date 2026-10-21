// Dashboards as a Studio kind: the `studio_*` provider methods, called
// in-process by Studio's hub (src/hub.ts).
import { copyTitle, eachId, fillTemplate, fillTemplateJson, type StudioItem, type StudioKind } from "../../kit/contract";
import { mustGet as requireItem, storeActions, storeSearch, type StudioProviderHandlers } from "../../kit/server/index";
import { DASHBOARD_ICON, DASHBOARD_KIND, PLUGIN_ID, dashboardHref } from "../shared";
import { buildView, dashboardText, displayName } from "./view";
import { parseDoc, type DashboardRow, type DashboardStore } from "./store";

export const DASHBOARD_STUDIO_KIND: StudioKind = {
  id: DASHBOARD_KIND,
  label: "Dashboard",
  plural: "Dashboards",
  icon: DASHBOARD_ICON,
  columns: [{ id: "widgets", label: "Widgets" }],
  actions: [],
  create: { mode: "rpc" },
  canArchive: true,
  capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: true, export: true, comments: false, versions: false, links: false, templates: true },
  mentionProviderId: "dashboard",
  blurb: "Live tiles, charts and feeds, laid out on a grid.",
  agentHint: "Read it with dashboard_read and change it with dashboard_edit; push data with widget_set_data.",
};

const PREVIEW_CHARS = 140;
const LIST_LIMIT = 10_000;

export function toStudioItem(store: DashboardStore, row: DashboardRow): StudioItem {
  const doc = store.doc(row.id);
  const titles = doc.widgets.map((widget) => widget.title).filter((title): title is string => Boolean(title)).join(" · ");
  const count = doc.widgets.length;
  return {
    id: row.id,
    kind: DASHBOARD_KIND,
    title: row.name.trim(),
    icon: null,
    projectId: row.project_id,
    parentId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by === "user" || row.updated_by === "agent" ? row.updated_by : null,
    preview: titles ? (titles.length > PREVIEW_CHARS ? `${titles.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : titles) : null,
    facts: [{ id: "widgets", value: count.toLocaleString("en-US"), sort: count }],
    badge: null,
    thumbnailUrl: null,
    href: dashboardHref(row.id),
    archived: row.archived_at !== null,
    template: Boolean(row.template),
  };
}

export function dashboardProvider(deps: { store: DashboardStore; changed(id: string): void; removed(id: string): void }): StudioProviderHandlers {
  const { store } = deps;
  const mustGet = (id: string) => requireItem((key) => store.get(key), id, "Dashboard not found.");
  const duplicate = (id: string, projectId: string | null, variables?: Record<string, string>) => {
    const source = mustGet(id);
    const docJson = JSON.stringify(store.doc(id));
    const doc = parseDoc(variables ? fillTemplateJson(docJson, variables) : docJson);
    // Widget ids stay: they're per dashboard. Approvals and data don't come along.
    const row = store.create({ name: variables ? fillTemplate(source.name, variables) : copyTitle(source.name), projectId, by: "user", doc });
    deps.changed(row.id);
    return toStudioItem(store, row);
  };

  return {
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: null, kinds: [DASHBOARD_STUDIO_KIND] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const row = store.get(id); return row ? [toStudioItem(store, row)] : []; }) }),
    studio_read: ({ id }) => { const row = store.get(id); return { content: row ? dashboardText(store, row) : null }; },
    studio_list: () => {
      const rows = store.list({ includeArchived: true, limit: LIST_LIMIT });
      return { items: rows.map((row) => toStudioItem(store, row)), truncated: rows.length === LIST_LIMIT };
    },
    studio_create: ({ kind, projectId }) => {
      if (kind !== DASHBOARD_KIND) throw new Error(`Unknown kind "${kind}".`);
      const row = store.create({ name: "", projectId, by: "user" });
      deps.changed(row.id);
      return { item: toStudioItem(store, row) };
    },
    studio_rename: ({ id, title }) => eachId([id], () => { mustGet(id); store.rename(id, title, "user"); deps.changed(id); }),
    studio_duplicate: ({ id, projectId }) => ({ item: duplicate(id, projectId) }),
    studio_template: ({ id, template }) => { mustGet(id); store.setTemplate(id, template); deps.changed(id); return { item: toStudioItem(store, mustGet(id)) }; },
    studio_instantiate: ({ id, projectId, variables }) => { if (!mustGet(id).template) throw new Error("Dashboard is not a template."); return { item: duplicate(id, projectId, variables) }; },
    studio_export: ({ id, format }) => {
      const row = mustGet(id);
      if (format !== "json") throw new Error(`Unsupported dashboard format: ${format}`);
      const view = buildView(store, row);
      const body = JSON.stringify({ name: row.name, widgets: view.widgets.map(({ script: _script, ...widget }) => widget), layouts: view.layouts, widgetTypes: view.widgetTypes }, null, 2);
      return { files: [{ name: `${displayName(row)}.dashboard.json`, mime: "application/json", data: Buffer.from(body).toString("base64") }] };
    },
    studio_action: ({ action }) => { throw new Error(`Unknown action "${action}".`); },
    ...storeActions({
      move: (id, projectId) => { mustGet(id); store.setProject(id, projectId); deps.changed(id); },
      archive: (id, archived) => { mustGet(id); store.setArchived(id, archived); deps.changed(id); },
      delete: (id) => { mustGet(id); store.delete(id); deps.removed(id); },
    }),
    studio_search: storeSearch({
      find: (query) => store.list({ limit: LIST_LIMIT })
        .map((row) => ({ id: row.id, text: dashboardText(store, row) }))
        .filter((row) => row.text.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 200),
      text: (row) => row.text,
    }),
  };
}
