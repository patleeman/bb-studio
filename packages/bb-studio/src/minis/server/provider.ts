// Mini apps as a Studio kind: the `studio_*` provider methods, called
// in-process by Studio's hub (src/hub.ts).
import { copyTitle, eachId, fillTemplate, type StudioItem, type StudioKind } from "../../kit/contract";
import { mustGet as requireItem, storeActions, storeSearch, type StudioProviderHandlers } from "../../kit/server/index";
import { MINI_ICON, MINI_KIND, miniHref, PLUGIN_ID } from "../shared";
import type { MiniRow, MiniStore } from "./store";

export const MINI_STUDIO_KIND: StudioKind = {
  id: MINI_KIND,
  label: "Mini app",
  plural: "Mini apps",
  icon: MINI_ICON,
  columns: [{ id: "records", label: "Records" }],
  actions: [],
  create: { mode: "rpc" },
  canArchive: true,
  capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: true, export: true, comments: false, versions: false, links: false, templates: true },
  mentionProviderId: "mini",
  blurb: "Small interactive apps with their own data, in pages, chats and tabs.",
  agentHint: "Read it with minis_read, change its source with minis_update, its records with minis_data, and drive it with minis_live.",
};

export const displayName = (row: Pick<MiniRow, "name">) => row.name.trim() || "Untitled mini app";

/** What search and `studio_read` see: the name, description, files and collections. */
export function miniText(store: MiniStore, row: MiniRow): string {
  const version = store.current(row.id);
  const collections = store.collections(row.id).map((each) => `${each.name} (${each.count})`).join(", ");
  return [
    displayName(row),
    version?.manifest.description ?? "",
    version ? `Files: ${Object.keys(version.files).join(", ")}` : "No source yet.",
    collections ? `Collections: ${collections}` : "",
  ].filter(Boolean).join("\n");
}

export function toStudioItem(store: MiniStore, row: MiniRow): StudioItem {
  const records = store.collections(row.id).reduce((sum, each) => sum + each.count, 0);
  const description = store.current(row.id)?.manifest.description ?? null;
  return {
    id: row.id,
    kind: MINI_KIND,
    title: row.name.trim(),
    icon: row.icon,
    projectId: row.project_id,
    parentId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by === "user" || row.updated_by === "agent" ? row.updated_by : null,
    preview: description,
    facts: [{ id: "records", value: records.toLocaleString("en-US"), sort: records }],
    badge: null,
    thumbnailUrl: null,
    href: miniHref(row.id),
    archived: row.archived_at !== null,
    template: Boolean(row.template),
  };
}

export function miniProvider(deps: {
  store: MiniStore;
  create(input: { name: string; projectId: string | null }): MiniRow;
  duplicate(id: string, input: { name: string; projectId: string | null; withData: boolean }): MiniRow;
  exportZip(id: string): { name: string; data: Buffer };
  changed(id: string): void;
  removed(id: string): void;
}): StudioProviderHandlers {
  const { store } = deps;
  const mustGet = (id: string) => requireItem((key) => store.get(key), id, "Mini app not found.");

  return {
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: null, kinds: [MINI_STUDIO_KIND] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const row = store.get(id); return row ? [toStudioItem(store, row)] : []; }) }),
    studio_read: ({ id }) => { const row = store.get(id); return { content: row ? miniText(store, row) : null }; },
    studio_list: () => {
      const rows = store.list({ includeArchived: true, limit: 10_000 });
      return { items: rows.map((row) => toStudioItem(store, row)), truncated: rows.length === 10_000 };
    },
    studio_create: ({ kind, projectId }) => {
      if (kind !== MINI_KIND) throw new Error(`Unknown kind "${kind}".`);
      return { item: toStudioItem(store, deps.create({ name: "", projectId })) };
    },
    studio_rename: ({ id, title }) => eachId([id], () => { mustGet(id); store.rename(id, title, "user"); deps.changed(id); }),
    // A copy keeps the source and starts with no records; templates fill in {{variables}} in the name.
    studio_duplicate: ({ id, projectId }) => ({ item: toStudioItem(store, deps.duplicate(id, { name: copyTitle(mustGet(id).name), projectId, withData: false })) }),
    studio_template: ({ id, template }) => { mustGet(id); store.setTemplate(id, template); deps.changed(id); return { item: toStudioItem(store, mustGet(id)) }; },
    studio_instantiate: ({ id, projectId, variables }) => {
      const row = mustGet(id);
      if (!row.template) throw new Error("Mini app is not a template.");
      return { item: toStudioItem(store, deps.duplicate(id, { name: fillTemplate(row.name, variables ?? {}), projectId, withData: false })) };
    },
    studio_export: ({ id, format }) => {
      mustGet(id);
      if (format !== "zip") throw new Error(`Unsupported mini app format: ${format}`);
      const file = deps.exportZip(id);
      return { files: [{ name: file.name, mime: "application/zip", data: file.data.toString("base64") }] };
    },
    studio_action: ({ action }) => { throw new Error(`Unknown action "${action}".`); },
    ...storeActions({
      move: (id, projectId) => { mustGet(id); store.setProject(id, projectId); deps.changed(id); },
      archive: (id, archived) => { mustGet(id); store.setArchived(id, archived); deps.changed(id); },
      delete: (id) => { mustGet(id); store.delete(id); deps.removed(id); },
    }),
    studio_search: storeSearch({
      find: (query) => store.list({ limit: 10_000 })
        .map((row) => ({ id: row.id, text: miniText(store, row) }))
        .filter((row) => row.text.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 200),
      text: (row) => row.text,
    }),
  };
}
