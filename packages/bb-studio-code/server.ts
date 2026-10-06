// bb-studio-code — server entry.
//
// A workspace is a Studio item: a title, the project (and so the Space) it
// belongs to, and the folders VS Code opens. Opening one starts code-server
// for it (src/server/runtime.ts); the app shows that editor in a frame.
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { eachId, studioSchemas, type StudioItem, type StudioKind } from "@bb-studio/kit/contract";
import { createChangeBus, createStoreProvider, mustGet } from "@bb-studio/kit/server";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CodeServers } from "./src/server/runtime";
import { MIGRATIONS, WorkspaceStore } from "./src/server/store";
import { CHANNEL, CODE_ICON, KIND_ID, PANEL_PATH, PLUGIN_ID, codeContract, workspaceHref, type Workspace } from "./src/shared";

const KIND: StudioKind = {
  id: KIND_ID,
  label: "Workspace",
  plural: "Workspaces",
  icon: CODE_ICON,
  columns: [{ id: "folders", label: "Folders" }],
  actions: [],
  create: { mode: "rpc" },
  canArchive: true,
  capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: false, export: false, comments: false, versions: false, links: false },
  blurb: "VS Code on one or more folders.",
  agentHint: "A workspace is a list of folders the user edits in VS Code; read its folders and work in them directly.",
};

const LIST_LIMIT = 10_000;

function item(workspace: Workspace): StudioItem {
  return {
    id: workspace.id,
    kind: KIND_ID,
    title: workspace.title,
    icon: null,
    projectId: workspace.projectId,
    parentId: null,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    updatedBy: null,
    preview: workspace.folders.length ? workspace.folders.join(" · ") : "No folders yet",
    facts: [{ id: "folders", value: String(workspace.folders.length), sort: workspace.folders.length }],
    badge: null,
    thumbnailUrl: null,
    href: workspaceHref(workspace.id),
    archived: workspace.archived,
  };
}

/** Folders must be full paths (or ~/…) to directories on this machine. */
async function checkFolders(folders: string[]): Promise<string[]> {
  const paths = folders.map((folder) => {
    const path = folder.trim().replace(/^~(?=$|\/)/, homedir());
    if (!isAbsolute(path)) throw new Error(`Use a full path: ${folder}`);
    return resolve(path);
  });
  const unique = [...new Set(paths)];
  for (const folder of unique) {
    const info = await stat(folder).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`Not a folder on this machine: ${folder}`);
  }
  return unique;
}

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new WorkspaceStore(db);
  const studio = studioSchemas(z);
  const changes = createChangeBus({ bb, channel: CHANNEL, pluginId: PLUGIN_ID, schemas: studio, event: (id) => ({ id }) });
  bb.onDispose(() => changes.dispose());
  const servers = new CodeServers({
    // <dataDir>/plugins/<id>/, beside the plugin's database.
    root: dirname(db.name),
    log: bb.log,
    onChange: (id) => bb.realtime.publish(CHANNEL, { id }),
  });
  bb.onDispose(() => servers.dispose());
  const must = (id: string) => mustGet((key) => store.get(key), id, "Workspace not found.");

  const projects = async () =>
    (await bb.sdk.projects.list({ includePersonal: true })).flatMap((project) => {
      const path = (project.sources.find((source) => source.isDefault) ?? project.sources[0])?.path;
      return path ? [{ id: project.id, name: project.name, path }] : [];
    });

  bb.rpc.register(codeContract, {
    get: ({ id }) => ({ workspace: store.get(id), status: servers.status(id) }),
    update: async ({ id, title, folders }) => {
      must(id);
      const workspace = store.update(id, {
        ...(title !== undefined ? { title } : {}),
        ...(folders !== undefined ? { folders: await checkFolders(folders) } : {}),
      });
      if (folders !== undefined) await servers.sync(workspace);
      changes.changed(id);
      return { workspace };
    },
    open: async ({ id }) => ({ status: await servers.open(must(id)) }),
    stop: ({ id }) => ({ status: servers.stop(must(id).id) }),
    projects: async () => ({ projects: await projects() }),
  });

  createStoreProvider(bb, studio, {
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: PANEL_PATH, kinds: [KIND] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const workspace = store.get(id); return workspace ? [item(workspace)] : []; }) }),
    studio_read: ({ id }) => {
      const workspace = store.get(id);
      return { content: workspace ? [`VS Code workspace "${workspace.title}"`, "Folders:", ...workspace.folders.map((folder) => `- ${folder}`)].join("\n") : null };
    },
    studio_list: () => {
      const items = store.list().slice(0, LIST_LIMIT).map(item);
      return { items, truncated: items.length === LIST_LIMIT };
    },
    // A new workspace opens its project's folder: a Space's own folder, or
    // the project it was made in.
    studio_create: async ({ kind, projectId }) => {
      if (kind !== KIND_ID) throw new Error(`Unknown kind "${kind}".`);
      const project = projectId ? (await projects()).find((candidate) => candidate.id === projectId) : undefined;
      const folders = project ? await checkFolders([project.path]).catch(() => []) : [];
      const workspace = store.create({ title: project?.name ?? "Workspace", projectId, folders });
      changes.changed(workspace.id);
      return { item: item(workspace) };
    },
    studio_rename: ({ id, title }) =>
      eachId([id], () => {
        must(id);
        store.update(id, { title });
        changes.changed(id);
      }),
    studio_action: ({ action }) => {
      throw new Error(`Unknown action "${action}".`);
    },
  }, {
    move: (id, projectId) => {
      must(id);
      store.update(id, { projectId });
      changes.changed(id);
    },
    archive: (id, archived) => {
      must(id);
      if (archived) servers.stop(id);
      store.update(id, { archived });
      changes.changed(id);
    },
    delete: (id) => {
      must(id);
      servers.stop(id);
      store.delete(id);
      changes.changed(id);
    },
  }, {
    find: (query) => store.list().filter((workspace) => `${workspace.title}\n${workspace.folders.join("\n")}`.toLowerCase().includes(query.toLowerCase())),
    text: (workspace) => `${workspace.title}\n${workspace.folders.join("\n")}`,
  });
}
