import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { StudioItem, StudioKind } from "../../kit/contract";
import type { StudioProviderHandlers } from "../../kit/server/index";
import type { Workspace } from "../shared";
import type { WorkspaceStore } from "./store";

export function workspaceItem(workspace: Workspace): StudioItem {
  return {
    id: workspace.id, kind: "workspace", title: workspace.title, icon: "Code", projectId: workspace.projectId,
    parentId: null, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt, updatedBy: null,
    preview: workspace.folders.join(", "), facts: [], badge: null, thumbnailUrl: null,
    href: `/plugins/studio/studio/workspaces/${encodeURIComponent(workspace.id)}`, archived: workspace.archived, template: false,
  };
}
const kind: StudioKind = {
  id: "workspace", label: "Workspace", plural: "Workspaces", icon: "Code", columns: [], actions: [], create: null,
  blurb: "VS Code on a thread’s worktree.", canArchive: false, mentionProviderId: "workspace",
  capabilities: { create: false, move: false, archive: false, delete: false, rename: false, duplicate: false, export: false, comments: false, versions: false, links: false, templates: false },
};
/** Existing item ids stay resolvable; new editors are opened from their thread. */
export function codeProvider(store: WorkspaceStore): StudioProviderHandlers {
  const unsupported = () => { throw new Error("Open the thread's VS Code tab to work with its workspace."); };
  return {
    studio_describe: () => ({ pluginId: "studio-code", version: 2, panel: null, kinds: [kind] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const row = store.get(id); return row ? [workspaceItem(row)] : []; }) }),
    studio_list: () => ({ items: store.list().map(workspaceItem), truncated: false }),
    studio_read: ({ id }) => { const row = store.get(id); return { content: row ? `${row.title}\n${row.folders.join("\n")}` : null }; },
    studio_search: ({ query }) => ({ ids: store.list().filter((row) => `${row.title} ${row.folders.join(" ")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 200).map((row) => row.id) }),
    studio_create: unsupported, studio_move: unsupported, studio_archive: unsupported, studio_delete: unsupported,
    studio_action: unsupported, studio_rename: unsupported, studio_duplicate: unsupported, studio_template: unsupported, studio_instantiate: unsupported, studio_export: unsupported,
  };
}
export function registerCodeMentions(bb: BbPluginApi, store: WorkspaceStore) {
  bb.ui.registerMentionProvider({
    id: "workspace", label: "Workspaces",
    search: ({ query }) => store.list().filter((row) => !row.archived && row.title.toLowerCase().includes(query.toLowerCase())).slice(0, 50).map((row) => ({ id: row.id, title: row.title, subtitle: row.folders.join(", ") })),
    resolve: (id) => {
      const row = store.get(id);
      if (!row) throw new Error("Workspace not found.");
      return { context: `${row.title}\n${row.folders.join("\n")}\n${workspaceItem(row).href}` };
    },
  });
}
