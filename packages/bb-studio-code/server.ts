// bb-studio-code — server entry.
//
// A workspace is a Studio item: a title, the project (and so the Space) it
// belongs to, and the folders VS Code opens. Opening one starts code-server
// for it (src/server/runtime.ts); the app shows that editor in a frame.
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { eachId, studioSchemas, type StudioItem, type StudioKind } from "@bb-studio/kit/contract";
import { createChangeBus, createStoreProvider, defineItemMention, mustGet, studioServices } from "@bb-studio/kit/server";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { listDir, readText } from "./src/server/files";
import { browseFolders, sensitiveFolder } from "./src/server/folders";
import { applyLayoutEverywhere, applyThemeEverywhere } from "./src/server/settings";
import type { BbTheme } from "./src/theme";
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
  capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: false, export: false, comments: false, versions: false, links: false, templates: false },
  mentionProviderId: "workspace",
  blurb: "VS Code on one or more folders.",
  agentHint: "A workspace is a list of folders the user edits in VS Code. Find one with code_workspaces_list; change its folders with code_workspace_set_folders.",
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
    preview: workspace.folders.length ? `${workspace.threadId ? "Thread worktree · " : ""}${workspace.folders.join(" · ")}` : "No folders yet",
    facts: [{ id: "folders", value: String(workspace.folders.length), sort: workspace.folders.length }],
    badge: null,
    thumbnailUrl: null,
    href: workspaceHref(workspace.id),
    archived: workspace.archived,
  };
}

/** The folders the file browser may serve; ones from before the secrets rule are skipped. */
function safeFolders(workspace: Workspace): string[] {
  return workspace.folders.filter((folder) => !sensitiveFolder(folder, homedir()));
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
    const reason = sensitiveFolder(folder, homedir());
    if (reason) throw new Error(`A workspace can't open ${folder}: it's ${reason}.`);
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
  // <dataDir>/plugins/<id>/, beside the plugin's database.
  const root = dirname(db.name);
  /** BB's palette as the app last sent it; kept so new workspaces start in it. */
  let theme: BbTheme | null = null;
  let themeKey = "";
  void bb.storage.kv.get<BbTheme>("theme").then((saved) => { theme ??= saved ?? null; themeKey = JSON.stringify(theme); });
  // Existing workspaces get a new layout once, the next time VS Code loads.
  void applyLayoutEverywhere(root, (message) => bb.log.warn(message)).catch(() => undefined);
  const servers = new CodeServers({
    root,
    log: bb.log,
    onChange: (id) => bb.realtime.publish(CHANNEL, { id }),
    theme: () => theme,
  });
  bb.onDispose(() => servers.dispose());
  // A reload stopped every server; open views recheck and start theirs again.
  const reloaded = setTimeout(() => { try { bb.realtime.publish(CHANNEL, { id: "*" }); } catch { /* No views yet. */ } }, 1000);
  bb.onDispose(() => clearTimeout(reloaded));
  const must = (id: string) => mustGet((key) => store.get(key), id, "Workspace not found.");

  const services = studioServices(bb.sdk);
  /** Links a workspace to a thread, so the thread's tab lists it. Studio is optional. */
  const link = (id: string, threadId: string, role: "created" | "edited") => {
    const at = Date.now();
    void services.linkThread({ threadId, ref: { pluginId: PLUGIN_ID, id }, role, state: "working", createdAt: at, updatedAt: at, metadata: {} }).catch(() => undefined);
  };
  /** The reply card that opens the workspace beside the chat. */
  const card = (id: string) => `Put this line on its own in your reply so the user can open the workspace beside the chat:\n::workspace{id="${id}"}`;

  /** The thread's working folder, when it's on the machine running BB. */
  const threadFolder = async (threadId: string) => {
    const thread = (await bb.sdk.threads.get({ threadId, include: "environment" })) as {
      title?: string | null;
      projectId?: string | null;
      environment?: { hostId: string; path: string | null } | null;
    };
    const environment = thread.environment;
    if (!environment?.path) throw new Error("This thread has no worktree or folder yet.");
    const { primaryHostId } = await bb.sdk.system.config();
    if (environment.hostId !== primaryHostId) throw new Error("This thread works on another machine. VS Code here can only open folders on the computer running BB.");
    return { path: environment.path, title: thread.title?.trim() || "Thread worktree", projectId: thread.projectId ?? null };
  };
  /** The thread's worktree workspace, made the first time. */
  const forThread = async (threadId: string) => {
    const existing = store.forThread(threadId);
    if (existing) return existing;
    const folder = await threadFolder(threadId);
    const workspace = store.create({ title: folder.title, projectId: folder.projectId, folders: await checkFolders([folder.path]), threadId });
    changes.changed(workspace.id);
    link(workspace.id, threadId, "created");
    return workspace;
  };

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
    forThread: async ({ threadId }) => ({ workspace: await forThread(threadId) }),
    listDir: async ({ id, path }) => {
      const folders = safeFolders(must(id));
      // The empty path lists the workspace's folders themselves.
      if (!path) return { entries: folders.map((folder) => ({ name: folder.split("/").filter(Boolean).at(-1) ?? folder, path: folder, dir: true })) };
      return { entries: await listDir(folders, path) };
    },
    readFile: async ({ id, path }) => readText(safeFolders(must(id)), path),
    browseFolders: ({ path, showHidden }) => browseFolders(path, homedir(), showHidden),
    projects: async () => ({ projects: await projects() }),
    syncTheme: async (next) => {
      const key = JSON.stringify(next);
      if (key === themeKey) return { changed: false };
      theme = next;
      themeKey = key;
      await bb.storage.kv.set("theme", next);
      await applyThemeEverywhere(root, next, (message) => bb.log.warn(message));
      return { changed: true };
    },
  });

  /** Agents name folders the user didn't pick: VS Code keeps trust on for them. */
  const untrust = (workspace: Workspace) => {
    if (!workspace.trusted) return workspace;
    const next = store.update(workspace.id, { trusted: false });
    // Its server skipped trust; restart without that. The open view reopens it.
    if (servers.status(workspace.id).state !== "stopped") servers.stop(workspace.id);
    return next;
  };

  const summary = (workspace: Workspace) =>
    `${workspace.id}\t${workspace.title}${workspace.threadId ? " (thread worktree)" : ""}\t${workspace.folders.join(", ") || "no folders"}`;
  bb.agents.registerTool({
    name: "code_workspaces_list",
    description: "List the user's VS Code workspaces (Studio Code): id, title and folders.",
    parameters: z.object({}),
    execute: () => store.list().filter((workspace) => !workspace.archived).map(summary).join("\n") || "No workspaces.",
  });
  bb.agents.registerTool({
    name: "code_workspace_open",
    description:
      "Give the user a VS Code workspace beside the chat. With no folders, it opens this thread's own worktree, so the user can review and edit your changes. With folders (full paths on the computer running BB), it makes a new workspace for them. Returns a card line for your reply.",
    parameters: z.object({
      folders: z.array(z.string().trim().min(1).max(4096)).max(50).optional(),
      title: z.string().trim().min(1).max(200).optional(),
    }),
    execute: async ({ folders, title }, ctx) => {
      let workspace: Workspace;
      if (folders?.length) {
        workspace = store.create({ title: title ?? "Workspace", projectId: ctx.projectId ?? null, folders: await checkFolders(folders), trusted: false });
        changes.changed(workspace.id);
        link(workspace.id, ctx.threadId, "created");
      } else {
        workspace = await forThread(ctx.threadId);
        if (title && title !== workspace.title) {
          workspace = store.update(workspace.id, { title });
          changes.changed(workspace.id);
        }
      }
      return `${summary(workspace)}\n${card(workspace.id)}`;
    },
  });
  bb.agents.registerTool({
    name: "code_workspace_set_folders",
    description: "Replace a workspace's folders (full paths on the computer running BB). An open VS Code updates without reloading.",
    parameters: z.object({ id: z.string().min(1).max(100), folders: z.array(z.string().trim().min(1).max(4096)).min(1).max(50) }),
    execute: async ({ id, folders }, ctx) => {
      untrust(must(id));
      const workspace = store.update(id, { folders: await checkFolders(folders) });
      await servers.sync(workspace);
      changes.changed(id);
      link(id, ctx.threadId, "edited");
      return `${summary(workspace)}\n${card(id)}`;
    },
  });
  // `@` and a workspace's name in a composer: its folders, for the agent.
  bb.ui.registerMentionProvider(
    defineItemMention({
      id: "workspace",
      label: "Workspaces",
      search: ({ query }) =>
        store.list()
          .filter((workspace) => !workspace.archived && `${workspace.title}\n${workspace.folders.join("\n")}`.toLowerCase().includes(query.toLowerCase()))
          .map((workspace) => ({ id: workspace.id, title: workspace.title, subtitle: workspace.folders.join(" · ") || "No folders" })),
      resolve: (id) => ({ context: `VS Code workspace "${must(id).title}" (${id}). Folders:\n${must(id).folders.map((folder) => `- ${folder}`).join("\n")}` }),
    }),
  );
  bb.agents.configure(() => ({ tools: ["code_workspaces_list", "code_workspace_open", "code_workspace_set_folders"], skills: ["studio-code"] }));

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
