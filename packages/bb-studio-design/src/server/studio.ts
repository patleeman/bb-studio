// Design as a Studio add-on: the `studio_*` methods Studio calls to list and
// manage designs in its collection.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { copyTitle, eachId, type StudioItem, type StudioKind, type StudioSchemas } from "@bb-studio/kit/contract";
import { createStoreProvider, mustGet as requireItem } from "@bb-studio/kit/server";
import { DESIGN_ICON, PLUGIN_ID, designHref } from "../shared";
import { displayName, type DesignRow, type DesignStore } from "./store";

export const DESIGN_KIND: StudioKind = {
  id: "design",
  label: "Design",
  plural: "Designs",
  icon: DESIGN_ICON,
  columns: [{ id: "screens", label: "Screens" }],
  actions: [],
  create: { mode: "rpc" },
  canArchive: true,
  capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: true, export: true, comments: false, versions: false, links: false, templates: false },
  mentionProviderId: "design",

  blurb: "UI prototypes made with your agents.",
  agentHint: "Read it with design_read and change it with design_write_screen or design_edit_screen.",
};

const PREVIEW_CHARS = 140;

/** Visible words from a screen's HTML, for search and previews. */
export function screenText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function designText(store: DesignStore, id: string): string {
  return store.screens(id).map((screen) => [`${screen.id} ${screen.caption}`.trim(), screenText(screen.html)].filter(Boolean).join("\n")).join("\n\n");
}

export function toStudioItem(store: DesignStore, row: DesignRow): StudioItem {
  const screens = store.screens(row.id);
  const latest = screens[0];
  const text = latest ? [latest.caption, screenText(latest.html)].filter(Boolean).join(" · ") : "";
  return {
    id: row.id,
    kind: DESIGN_KIND.id,
    title: row.name.trim(),
    icon: null,
    projectId: row.project_id,
    parentId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by === "user" || row.updated_by === "agent" ? row.updated_by : null,
    preview: text ? (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : text) : null,
    facts: [{ id: "screens", value: screens.length.toLocaleString("en-US"), sort: screens.length }],
    badge: null,
    thumbnailUrl: null,
    href: designHref(row.id),
    archived: row.archived_at !== null,
    template: Boolean(row.template),
  };
}

/** Studio lists at most this many; past it, Studio keeps tags of items it didn't see. */
const LIST_LIMIT = 10_000;

export function registerStudio(
  bb: Pick<BbPluginApi, "rpc">,
  schemas: StudioSchemas,
  deps: { store: DesignStore; changed(id: string): void },
): void {
  const { store } = deps;
  const mustGet = (id: string) => requireItem((key) => store.get(key), id, "Design not found.");
  const item = (id: string) => toStudioItem(store, mustGet(id));

  createStoreProvider(bb, schemas, {
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: "designs", kinds: [DESIGN_KIND] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const row = store.get(id); return row ? [toStudioItem(store, row)] : []; }) }),
    studio_read: ({ id }) => ({ content: store.get(id) ? designText(store, id) : null }),
    studio_list: () => {
      const rows = store.list({ includeArchived: true, limit: LIST_LIMIT });
      return { items: rows.map((row) => toStudioItem(store, row)), truncated: rows.length === LIST_LIMIT };
    },
    studio_create: ({ kind, projectId }) => {
      if (kind !== DESIGN_KIND.id) throw new Error(`Unknown kind "${kind}".`);
      const row = store.create({ name: "", projectId, by: "app" });
      deps.changed(row.id);
      return { item: toStudioItem(store, row) };
    },
    studio_rename: ({ id, title }) =>
      eachId([id], () => {
        mustGet(id);
        store.rename(id, title, "app");
        deps.changed(id);
      }),
    studio_duplicate: ({ id, projectId }) => {
      const row = store.copy(id, { name: copyTitle(mustGet(id).name), projectId, by: "app" });
      deps.changed(row.id);
      return { item: item(row.id) };
    },
    studio_export: ({ id, format }) => {
      if (format !== "html") throw new Error(`Unsupported design format: ${format}`);
      const name = displayName(mustGet(id));
      const screens = store.screens(id);
      if (!screens.length) throw new Error("This design has no screens yet.");
      return { files: screens.map((screen) => ({ name: `${name} ${screen.id}.html`, mime: "text/html", data: Buffer.from(screen.html).toString("base64") })) };
    },
    studio_action: ({ action }) => {
      throw new Error(`Unknown action "${action}".`);
    },
  }, {
    move: (id: string, projectId: string | null) => {
      mustGet(id);
      store.setProject(id, projectId);
      deps.changed(id);
    },
    archive: (id: string, archived: boolean) => {
      mustGet(id);
      store.setArchived(id, archived);
      deps.changed(id);
    },
    delete: (id: string) => {
      mustGet(id);
      store.delete(id);
      deps.changed(id);
    },
  }, {
    find: (query) => store.list({ limit: LIST_LIMIT })
      .map((row) => ({ id: row.id, text: `${displayName(row)}\n${designText(store, row.id)}` }))
      .filter((row) => row.text.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 200),
    text: (row) => row.text,
  });
}
