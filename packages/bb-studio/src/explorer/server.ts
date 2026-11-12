// The Explorer's backend: the folder tree's RPC, automatic filing, and the
// agent tools explorer_list and explorer_file. The Explorer's view is gone
// (the Bot sidebar and the Library replaced it); the tables, the RPC and the
// filing stay underneath, and the tools are registered but not given to
// agents (server.ts).
//
// Automatic filing (auto-file.ts) runs at three moments:
// - an agent's tool made an item (StudioServices.created): the item joins
//   the folder of the thread that made it;
// - an item changed and has no filing yet: one made under another item (a
//   sub-page) joins that item's folder;
// - BB made a thread with a parent (`thread.created`): it joins its parent's
//   folder.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { ItemIndex } from "../item-index";
import { autoFileFolder, NO_PROJECT_NAME, pathProject, splitFolderPath } from "./auto-file";
import { ExplorerStore, type FilingTarget, type Folder } from "./store";

export const EXPLORER_TOOLS = ["explorer_list", "explorer_file"] as const;

type Project = { id: string; name: string };

export interface ExplorerDeps {
  index: Pick<ItemIndex, "get">;
  /** A thread's project and parent, or null when BB has no such thread. */
  thread(threadId: string): Promise<{ projectId: string | null; parentThreadId: string | null } | null>;
  projects(): Promise<Project[]>;
  /** Tells every window the tree changed. */
  changed(): void;
  /** Every Bot's side threads ("Reply in thread" forks) with the thread each answers, as the Bot page knows them. */
  sideThreads?(): { threadId: string; parentThreadId: string }[];
  /** The threads of Bots' runners, as the Automations page knows them. */
  runnerThreads?(): string[];
}

/** The folder tree as indented lines with ids, for explorer_list. */
export function describeFolders(folders: readonly Folder[], projects: readonly Project[], counts: ReadonlyMap<string, number>): string {
  const lines: string[] = [];
  const walk = (projectId: string | null, parentId: string | null, depth: number) => {
    for (const each of folders.filter((folder) => folder.projectId === projectId && folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))) {
      const filed = counts.get(each.id) ?? 0;
      lines.push(`${"  ".repeat(depth)}- ${each.name} (folder ${each.id}${filed ? `, ${filed} filed` : ""})`);
      if (depth < 20) walk(projectId, each.id, depth + 1);
    }
  };
  for (const project of [...projects.map((each) => ({ id: each.id as string | null, name: each.name })), { id: null, name: NO_PROJECT_NAME }]) {
    lines.push(`${project.name}${project.id ? ` (project ${project.id})` : ""}`);
    walk(project.id, null, 1);
  }
  return lines.join("\n");
}

export function registerExplorer(bb: Pick<BbPluginApi, "agents" | "events">, db: Database.Database, deps: ExplorerDeps) {
  const store = new ExplorerStore(db);
  const autoFile = (target: FilingTarget, projectId: string | null, sources: readonly FilingTarget[]): boolean => {
    const folderId = autoFileFolder({ current: store.filingOf(target), projectId, sources: sources.map((source) => store.filingOf(source)), folder: (id) => store.folder(id) });
    if (!folderId || !store.file([target], folderId, "auto").length) return false;
    deps.changed();
    return true;
  };
  /** An item an agent's tool just made in `threadId`: beside that thread, else beside the item above it. */
  const itemCreated = (itemId: string, threadId: string | null): boolean => {
    const item = deps.index.get(itemId);
    if (!item) return false;
    return autoFile({ kind: "item", id: itemId }, item.projectId, [...(threadId ? [{ kind: "thread" as const, id: threadId }] : []), ...(item.parentId ? [{ kind: "item" as const, id: item.parentId }] : [])]);
  };
  /** Items that changed or were removed (Studio's change notice). */
  const itemsChanged = (ids: readonly string[] = [], removed: readonly string[] = []): void => {
    for (const id of ids) itemCreated(id, null);
    if (removed.length && store.unfile(removed.map((id) => ({ kind: "item" as const, id })))) deps.changed();
  };
  const threadCreated = (thread: { id: string; projectId?: string | null; parentThreadId?: string | null }): boolean =>
    thread.parentThreadId ? autoFile({ kind: "thread", id: thread.id }, thread.projectId ?? null, [{ kind: "thread", id: thread.parentThreadId }]) : false;
  bb.events.on("thread.created", ({ thread }) => { try { threadCreated(thread as never); } catch { /* filing is a convenience: never fail thread creation */ } });
  bb.events.on("thread.deleted", ({ thread }) => { try { if (store.unfile([{ kind: "thread", id: thread.id }])) deps.changed(); } catch { /* the row is harmless */ } });

  const did = <T>(result: T): T => { deps.changed(); return result; };
  const rpc = {
    explorer_tree: () => ({
      folders: store.folders(), filing: store.filings(),
      ...(deps.sideThreads ? { sideThreads: deps.sideThreads() } : {}),
      ...(deps.runnerThreads ? { runnerThreadIds: deps.runnerThreads() } : {}),
    }),
    explorer_folder_create: (input: { projectId: string | null; parentId: string | null; name: string }) => did({ folder: store.createFolder(input) }),
    explorer_folder_rename: ({ id, name }: { id: string; name: string }) => did({ folder: store.renameFolder(id, name) }),
    explorer_folder_move: ({ id, parentId }: { id: string; parentId: string | null }) => did({ folder: store.moveFolder(id, parentId) }),
    explorer_folder_delete: ({ id }: { id: string }) => did({ ok: store.deleteFolder(id) }),
    explorer_file: ({ targets, folderId }: { targets: FilingTarget[]; folderId: string | null }) => { store.file(targets, folderId, "user"); return did({ ok: true }); },
    explorer_unfile: ({ targets }: { targets: FilingTarget[] }) => { store.unfile(targets); return did({ ok: true }); },
  };

  /** The project a thread or item is in; throws when it doesn't exist. */
  const projectOf = async (target: FilingTarget): Promise<string | null> => {
    if (target.kind === "item") {
      const item = deps.index.get(target.id);
      if (!item) throw new Error(`No Studio item with id ${target.id}. Pass the item's id (pg_…, dsn_…, mini_…), not its link.`);
      return item.projectId;
    }
    const thread = await deps.thread(target.id);
    if (!thread) throw new Error(`No thread with id ${target.id}.`);
    return thread.projectId;
  };

  bb.agents.registerTool({
    name: "explorer_list",
    description: "List the folders of the user's Explorer (BB Studio's sidebar tree): each project, then its folders nested, with folder ids. Use it to choose a folder for explorer_file.",
    parameters: z.object({}),
    async execute() {
      const counts = new Map<string, number>();
      for (const each of store.filings()) if (each.folderId) counts.set(each.folderId, (counts.get(each.folderId) ?? 0) + 1);
      return describeFolders(store.folders(), await deps.projects(), counts);
    },
  });
  bb.agents.registerTool({
    name: "explorer_file",
    description: "File a thread or a Studio item (page, whiteboard, design, app) into a folder of the user's Explorer. Give `folder` (an id from explorer_list) or `path` (\"Project/Sub/Folder\", first part the project's name or \"No project\"; missing folders are created). A path that is only the project puts it back at the project's root. A folder must be in the thing's own project. Things you create are filed beside your thread already; use this when the user asks to file or move something, or to group related work.",
    parameters: z.object({
      target: z.object({ kind: z.enum(["thread", "item"]), id: z.string().min(1).max(200) }),
      folder: z.string().min(1).max(100).optional().describe("A folder id, from explorer_list"),
      path: z.string().min(1).max(1000).optional().describe('"Project/Sub/Folder"; created if missing'),
    }),
    async execute({ target, folder, path }) {
      if (!folder === !path) return "Give either `folder` (an id) or `path`, not both.";
      const projectId = await projectOf(target);
      let into: Folder | null;
      if (folder) {
        into = store.folder(folder);
        if (!into) return `No folder with id ${folder}. List folders with explorer_list.`;
      } else {
        const [first, ...names] = splitFolderPath(path!);
        if (!first) return "The path is empty.";
        const projects = await deps.projects();
        const project = pathProject(first, projects);
        if (!project) return `No project called "${first}". Projects: ${[...projects.map((each) => each.name), NO_PROJECT_NAME].join(", ")}.`;
        if (project.projectId !== projectId) return `That ${target.kind} is in another project, and a folder holds only its own project's things. ${target.kind === "item" ? "Move the item first with studio_move_items." : "A thread can't change project."}`;
        into = names.length ? store.ensurePath(project.projectId, names) : null;
      }
      if (into && into.projectId !== projectId) return `That folder is in another project than the ${target.kind}. ${target.kind === "item" ? "Move the item first with studio_move_items." : "A thread can't change project."}`;
      store.file([target], into?.id ?? null, "agent");
      deps.changed();
      return into ? `Filed in ${store.path(into.id).map((each) => each.name).join("/")} (folder ${into.id}).` : "Placed at the project's root.";
    },
  });

  return { store, rpc, itemCreated, itemsChanged, threadCreated };
}
