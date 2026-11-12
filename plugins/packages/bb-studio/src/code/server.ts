import { rpcContract } from "./contract";
import { codeProvider, registerCodeMentions } from "./server/provider";
// Studio Code — server entry.
//
// VS Code is the editor: each folder gets one workspace, a thread's worktree
// (its BB environment) or else its project's folder, shown in a VS Code tab.
// Threads on the same worktree share that editor. Opening it starts
// code-server for it (src/server/runtime.ts); the app shows it in a frame.
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createChangeBus, mustGet } from "../kit/server/index";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { studioSchemas } from "../kit/contract";
import { listenForFileChanges, type ThreadFileChange } from "../kit/host-events";
import { fileChangeActivities, type Activity } from "./server/activity";
import { editorCallSchema, isEditorCall, selectionMessage, type EditorCall } from "./server/ask";
import { Bridges, editorContext, shown } from "./server/bridge";
import { CommentStore, commentCallSchema, describeThread, reviewMessage } from "./server/comments";
import { installBridge } from "./server/bridge-extension";
import { editOnDisk, editOutcome, editSchema } from "./server/edits";
import { contained, listDir, readText } from "./server/files";
import { relatedWorkspaces } from "./server/chip";
import { sensitiveFolder } from "./server/folders";
import { applyThemeEverywhere } from "./server/settings";
import { BASE_THEME, vscodeColors, type BbTheme } from "./theme";
import { CodeServers } from "./server/runtime";
import { followWorktree, missingWorktreeMessage } from "./server/worktree-sync";
import { ThreadWatcher } from "./server/watch";
import { WorkspaceStore } from "./server/store";
import { CHANNEL, folderKey, tabParamsOfKey, type CodeTabParams, type EditorOpen, type Workspace } from "./shared";

/** Typing takes about 3 seconds an edit; allow for up to 20 of them. A window with no screen says so within 5. */
const EDIT_TIMEOUT_MS = 90_000;

/** The folders the file browser may serve; ones from before the secrets rule are skipped. */
function safeFolders(workspace: Workspace): string[] {
  return workspace.folders.filter((folder) => !sensitiveFolder(folder, homedir()));
}

/** Whether a workspace still has a folder on this machine to open. */
async function hasFolder(workspace: Workspace): Promise<boolean> {
  for (const folder of workspace.folders) if ((await stat(folder).catch(() => null))?.isDirectory()) return true;
  return false;
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

export const CODE_TOOLS = ["code_workspace_open", "code_editor_state", "code_show", "code_edit", "code_comments", "code_comment_reply"];

export function registerCode(bb: BbPluginApi, db: import("better-sqlite3").Database) {
  const store = new WorkspaceStore(db);
  const comments = new CommentStore(db);
  // Keep both editor views and Studio's collection/search aware of workspaces.
  const changes = createChangeBus({ bb, channel: CHANNEL, pluginId: "studio-code", schemas: studioSchemas(z), event: (id) => ({ id }) });
  bb.onDispose(() => changes.dispose());
  // <dataDir>/plugins/<id>/, beside the plugin's database.
  const root = join(dirname(db.name), "code");
  /** BB's palette as the app last sent it; kept so new workspaces start in it. */
  let theme: BbTheme | null = null;
  let themeKey = "";
  void bb.storage.kv.get<BbTheme>("code:theme").then((saved) => { theme ??= saved ?? null; themeKey = JSON.stringify(theme); });

  // The bridge between each workspace's VS Code and the agent (src/server/bridge.ts).
  // An editor connecting starts following threads already at work (declared below).
  let followWorking: (workspaceId: string) => void = () => undefined;
  // Review comments from the editor (src/server/comments.ts), declared below.
  let commentCall: (workspaceId: string, call: unknown) => Promise<unknown> = async () => null;
  const bridges = new Bridges(
    (message) => bb.log.info(message),
    (id) => followWorking(id),
    // BB's shortcuts pressed inside VS Code: the page with that editor focused replays them.
    (id, key) => bb.realtime.publish(CHANNEL, { type: "key", id, key }),
    (id, call) => commentCall(id, call),
  );

  const servers = new CodeServers({
    root,
    log: bb.log,
    onChange: (id) => {
      bb.realtime.publish(CHANNEL, { id });
      const state = servers.status(id).state;
      if (state === "stopped" || state === "failed") void bridges.close(id);
    },
    theme: () => theme,
    beforeOpen: async (signal) => {
      signal.throwIfAborted();
      await installBridge(join(root, "extensions"));
    },
    env: async (id, dir) => ({ STUDIO_CODE_BRIDGE: await bridges.open(id, dir) }),
  });
  bb.onDispose(() => servers.dispose());
  bb.onDispose(() => bridges.closeAll());
  // A reload stopped every server; open views recheck and start theirs again.
  const reloaded = setTimeout(() => { try { bb.realtime.publish(CHANNEL, { id: "*" }); } catch { /* No views yet. */ } }, 1000);
  bb.onDispose(() => clearTimeout(reloaded));
  const must = (id: string) => mustGet((key) => store.get(key), id, "Workspace not found.");

  /**
   * A folder VS Code opens. `key` is its identity (`env:<id>` or
   * `project:<id>`): one workspace per key, whichever thread asks. Null when
   * BB names no environment for a thread's folder; that thread keeps a
   * workspace of its own.
   */
  type Folder = { key: string | null; path: string; title: string; projectId: string | null };
  type Environment = { id?: string; hostId: string; path: string | null; name?: string | null; branchName?: string | null; projectId?: string | null };
  const OTHER_MACHINE = "VS Code here can only open folders on the computer running BB.";
  const environmentTitle = (environment: Environment, path: string) => environment.name?.trim() || environment.branchName?.trim() || basename(path);
  /** A worktree or checkout (a BB environment), when it's on the machine running BB. */
  const environmentFolder = async (environmentId: string): Promise<Folder> => {
    const environment = (await bb.sdk.environments.get({ environmentId })) as Environment;
    if (!environment.path) throw new Error("This worktree has no folder yet.");
    const { primaryHostId } = await bb.sdk.system.config();
    if (environment.hostId !== primaryHostId) throw new Error(`This worktree is on another machine. ${OTHER_MACHINE}`);
    return { key: folderKey({ environmentId }), path: environment.path, title: environmentTitle(environment, environment.path), projectId: environment.projectId ?? null };
  };
  /** A project's own folder on the machine running BB. */
  const projectFolder = async (projectId: string): Promise<Folder> => {
    const project = (await bb.sdk.projects.get({ projectId })) as { name?: string | null; sources?: { hostId: string; path: string; isDefault?: boolean }[] };
    const { primaryHostId } = await bb.sdk.system.config();
    const here = (project.sources ?? []).filter((source) => source.hostId === primaryHostId);
    const source = here.find((each) => each.isDefault) ?? here[0];
    if (!source) throw new Error(`This project has no folder on the computer running BB. ${OTHER_MACHINE}`);
    return { key: folderKey({ projectId }), path: source.path, title: project.name?.trim() || basename(source.path), projectId };
  };
  /** The thread's folder: its worktree when it has one, else its project's folder. */
  const threadFolder = async (threadId: string): Promise<Folder> => {
    const thread = (await bb.sdk.threads.get({ threadId, include: "environment" })) as {
      title?: string | null;
      projectId?: string | null;
      environmentId?: string | null;
      environment?: Environment | null;
    };
    const environment = thread.environment;
    if (!environment?.path) {
      // No worktree: the project's folder, where it has one here.
      const folder = thread.projectId ? await projectFolder(thread.projectId).catch(() => null) : null;
      if (!folder) throw new Error("This thread has no worktree or folder yet.");
      return folder;
    }
    const { primaryHostId } = await bb.sdk.system.config();
    if (environment.hostId !== primaryHostId) throw new Error(`This thread works on another machine. ${OTHER_MACHINE}`);
    const environmentId = environment.id ?? thread.environmentId ?? null;
    if (!environmentId) return { key: null, path: environment.path, title: thread.title?.trim() || "Thread worktree", projectId: thread.projectId ?? null };
    return { key: folderKey({ environmentId }), path: environment.path, title: environmentTitle(environment, environment.path), projectId: thread.projectId ?? environment.projectId ?? null };
  };
  /**
   * The folder's workspace, made the first time. `threadId`: the thread that
   * asks. A workspace it had of its own, from before workspaces were shared,
   * becomes the folder's, so its open files and comments carry over.
   */
  const openFolder = async (folder: Folder, threadId: string | null) => {
    const checked = async (path: string) => {
      try {
        return await checkFolders([path]);
      } catch (cause) {
        if (!(await stat(path).catch(() => null))) throw new Error(missingWorktreeMessage(path));
        throw cause;
      }
    };
    let existing = folder.key ? store.forFolder(folder.key) : null;
    if (!existing && threadId) {
      const own = store.forThread(threadId);
      if (own && own.folderKey === null) existing = folder.key ? store.adopt(own.id, folder.key, folder.title) : own;
    }
    if (existing) {
      const next = followWorktree(existing.folders, folder.path);
      if (next.length === existing.folders.length && next.every((each, i) => each === existing.folders[i])) return existing;
      await checked(folder.path);
      const moved = store.update(existing.id, { folders: next });
      await servers.sync(moved);
      changes.changed(moved.id);
      return moved;
    }
    const workspace = store.create({ title: folder.title, projectId: folder.projectId, folders: await checked(folder.path), threadId: folder.key ? null : threadId, folderKey: folder.key });
    changes.changed(workspace.id);
    return workspace;
  };
  /** Each thread's workspace as last resolved, kept for when BB can't name its folder (a worktree that's gone). */
  const lastWorkspace = new Map<string, string>();
  /** The workspace of the thread's folder, made the first time. Two threads on one worktree get the same one. */
  const forThread = async (threadId: string) => {
    const folder = await threadFolder(threadId).catch((cause) => {
      // Without a current folder to compare, keep the workspace the thread has.
      const kept = store.forThread(threadId) ?? store.get(lastWorkspace.get(threadId) ?? "");
      if (kept && !kept.archived) return kept;
      throw cause;
    });
    const workspace = "id" in folder ? folder : await openFolder(folder, threadId);
    lastWorkspace.set(threadId, workspace.id);
    cap(lastWorkspace);
    // The first thread to use a workspace is where its review and questions go, until a tab shows it.
    if (!store.reviewThread(workspace.id)) store.setReviewThread(workspace.id, threadId);
    return workspace;
  };
  const forFolder = async (params: CodeTabParams) =>
    openFolder("environmentId" in params ? await environmentFolder(params.environmentId) : await projectFolder(params.projectId), null);
  /** Every "show this file in VS Code" goes through here: the agent's code_show, links, BB's file opener and its diff. Held until an editor connects. */
  const showInEditor = (workspace: Workspace, file: string, startLine: number, endLine?: number) =>
    bridges.send(workspace.id, { type: "show", path: file, startLine, endLine: Math.max(endLine ?? startLine, startLine) });

  bb.rpc.register(rpcContract, {
    "code.get": ({ id }) => ({ workspace: store.get(id), status: servers.status(id) }),
    "code.update": ({ id, share }) => {
      must(id);
      const workspace = store.update(id, { share });
      changes.changed(id);
      return { workspace };
    },
    "code.open": async ({ id }) => {
      const workspace = must(id);
      // Opened by its address (the VS Code panel, a link), nothing has checked the folder since it was made.
      if (!workspace.folders.length) throw new Error("This workspace has no folder to open.");
      if (!(await hasFolder(workspace))) throw new Error(`This workspace's folder is gone: ${workspace.folders[0]}`);
      store.markOpened(id);
      return { status: await servers.open(workspace) };
    },
    "code.stop": ({ id }) => ({ status: servers.stop(must(id).id) }),
    "code.threadWorkspace": ({ threadId }) => ({ workspace: store.forThread(threadId) ?? null }),
    "code.forThread": async ({ threadId }) => ({ workspace: await forThread(threadId) }),
    "code.forFolder": async (params) => ({ workspace: await forFolder(params) }),
    // The VS Code panel opens this one with no thread to ask: one whose folder is gone would only fail to start.
    "code.recent": async () => {
      for (const workspace of store.recents()) if (await hasFolder(workspace)) return { workspace };
      return { workspace: null };
    },
    "code.list": async () => ({ workspaces: await Promise.all(store.recents().map(async (workspace) => ({ ...workspace, missing: !(await hasFolder(workspace)) }))) }),
    "code.listDir": async ({ id, path }) => {
      const folders = safeFolders(must(id));
      // The empty path lists the workspace's folders themselves.
      if (!path) return { entries: folders.map((folder) => ({ name: folder.split("/").filter(Boolean).at(-1) ?? folder, path: folder, dir: true })) };
      return { entries: await listDir(folders, path) };
    },
    "code.readFile": async ({ id, path }) => readText(safeFolders(must(id)), path),
    "code.viewedFrom": ({ id, threadId }) => { must(id); store.setReviewThread(id, threadId); return { ok: true as const }; },
    "code.editorState": ({ id }) => ({ state: bridges.connected(id) ? bridges.state(id) : null }),
    "code.reveal": async ({ id, path, startLine, endLine }) => {
      const workspace = must(id);
      const file = isAbsolute(path) ? resolve(path) : resolve(workspace.folders[0] ?? "/", path);
      if (!workspace.folders.some((folder) => inside(folder, file))) throw new Error("That file isn't in this workspace.");
      await contained(safeFolders(workspace), file);
      return { shown: showInEditor(workspace, file, startLine, endLine) };
    },
    "code.syncTheme": async (next) => {
      const key = JSON.stringify(next);
      // An editor started before the extension could restyle in place reloads instead.
      const old = () => store.list().some((workspace) => bridges.connected(workspace.id) && !bridges.upToDate(workspace.id));
      if (key === themeKey) return { changed: false, reload: old() };
      bb.log.info(`theme changed (${next.mode}, background ${next.colors.background}); open editors restyle`);
      theme = next;
      themeKey = key;
      await bb.storage.kv.set("code:theme", next);
      // Open editors apply the colors themselves, in place; the rest read them from their settings when they start.
      const live = new Set<string>();
      for (const workspace of store.list()) {
        if (bridges.broadcast(workspace.id, { type: "theme", base: BASE_THEME[next.mode], colors: vscodeColors(next) }) && bridges.upToDate(workspace.id)) live.add(workspace.id);
      }
      await applyThemeEverywhere(root, next, (message) => bb.log.warn(message), (id) => live.has(id));
      return { changed: true, reload: old() };
    },
  });

  bb.agents.registerTool({
    name: "code_workspace_open",
    description:
      "Open VS Code beside the chat on this thread's worktree (or its project's folder), so the user can review and edit your changes. Threads on the same worktree share one; this makes it the first time. The user opens it from the VS Code tab.",
    parameters: z.object({}),
    execute: async (_input, ctx) => {
      const workspace = await forThread(ctx.threadId);
      return `This thread's VS Code is ready on ${workspace.folders.join(", ") || "no folder"}. The user sees it in the VS Code tab.`;
    },
  });

  // ---- The agent and the user's editor --------------------------------------

  /** Per-thread caches keep their newest entries only. */
  const MAX_THREADS_KEPT = 500;
  const cap = <V>(map: Map<string, V>) => { while (map.size > MAX_THREADS_KEPT) map.delete(map.keys().next().value!); };
  /** Forgets a deleted or archived thread (set below, once its caches exist). */
  let forget: (threadId: string) => void = () => undefined;
  /** Each thread's working folder, refreshed when it starts a turn. */
  const threadPaths = new Map<string, string | null>();
  /** Each thread's folder key (`env:<id>` or `project:<id>`), filled with its path. */
  const threadKeys = new Map<string, string | null>();
  const threadPath = async (threadId: string): Promise<string | null> => {
    if (threadPaths.has(threadId)) return threadPaths.get(threadId)!;
    try {
      const thread = (await bb.sdk.threads.get({ threadId, include: "environment" })) as { projectId?: string | null; environmentId?: string | null; environment?: { id?: string; path: string | null } | null };
      const path = thread.environment?.path ?? null;
      const environmentId = path ? thread.environment?.id ?? thread.environmentId ?? null : null;
      threadPaths.set(threadId, path);
      threadKeys.set(threadId, environmentId ? folderKey({ environmentId }) : !path && thread.projectId ? folderKey({ projectId: thread.projectId }) : null);
      cap(threadPaths);
      cap(threadKeys);
      return path;
    } catch {
      return null;
    }
  };
  /** Whether the workspace is the thread's own: made for it, or for its folder. Call threadPath first. */
  const own = (workspace: Workspace, threadId: string) =>
    workspace.threadId === threadId || (workspace.folderKey !== null && workspace.folderKey === (threadKeys.get(threadId) ?? null));
  bb.events.on("thread.active", ({ thread }) => { threadPaths.delete(thread.id); threadKeys.delete(thread.id); void threadPath(thread.id); });
  for (const event of ["thread.deleted", "thread.archived"] as const)
    bb.events.on(event, ({ thread }) => { threadPaths.delete(thread.id); threadKeys.delete(thread.id); lastWorkspace.delete(thread.id); forget(thread.id); });

  const inside = (folder: string, path: string) => path === folder || path.startsWith(`${folder.replace(/\/+$/, "")}/`);
  // User RPCs are trusted; agent tools use their caller's thread scope.
  const usable = (workspace: Workspace, threadId: string, path: string | null) =>
    !workspace.archived && (own(workspace, threadId) || workspace.share ||
      (path !== null && workspace.folders.some((folder) => inside(folder, path))));
  /**
   * Workspaces with a VS Code open whose editor this thread may see: the one
   * made for it, or one whose folders hold its folder, with sharing on
   * (src/server/chip.ts, relatedWorkspaces).
   */
  const editorsFor = (threadId: string, _projectId: string | null, path: string | null) =>
    relatedWorkspaces(store.list(), threadId, path, threadKeys.get(threadId) ?? null).filter((workspace) => bridges.connected(workspace.id) && bridges.state(workspace.id) !== null);
  const contextFor = (threadId: string, projectId: string | null, path: string | null) =>
    editorContext(editorsFor(threadId, projectId, path).map((workspace) => ({ title: workspace.title, folders: workspace.folders, state: bridges.state(workspace.id)! })));

  // Each turn starts knowing what the user has open. The provider can't wait,
  // so a thread's folder comes from the cache (filled as turns start).
  bb.agents.contributeInstructions(({ threadId, projectId }) => {
    if (!threadPaths.has(threadId)) void threadPath(threadId);
    return contextFor(threadId, projectId, threadPaths.get(threadId) ?? null);
  });

  bb.agents.registerTool({
    name: "code_editor_state",
    description: "What the user has open in VS Code (Studio Code) right now: the file, the lines on screen, their selection, errors, and files with unsaved changes.",
    parameters: z.object({}),
    execute: async (_input, ctx) => {
      const path = await threadPath(ctx.threadId);
      const workspaces = store.list().filter((workspace) => usable(workspace, ctx.threadId, path) && bridges.connected(workspace.id) && bridges.state(workspace.id) !== null);
      return editorContext(workspaces.map((workspace) => ({ title: workspace.title, folders: workspace.folders, state: bridges.state(workspace.id)! }))) ?? "The user has no VS Code open for this thread right now.";
    },
  });

  /**
   * Prefer the thread's own workspace, then an allowed open editor or
   * stored workspace, creating its own worktree workspace if needed. The path is
   * checked through symlinks, but used as the workspace knows it: VS Code
   * treats /tmp/x and /private/tmp/x as two different files.
   */
  const target = async (path: string, ctx: { threadId: string; projectId?: string | null }) => {
    const base = await threadPath(ctx.threadId);
    const absolute = isAbsolute(path) ? resolve(path) : base ? resolve(base, path) : null;
    if (!absolute) throw new Error("Give a full path: this thread has no working folder to start from.");
    const holds = (workspace: Workspace) => !workspace.archived && workspace.folders.some((folder) => inside(folder, absolute));
    const allowed = store.list().filter((workspace) => usable(workspace, ctx.threadId, base));
    let workspace = allowed.find((each) => own(each, ctx.threadId) && holds(each)) ?? allowed.find((each) => holds(each) && bridges.connected(each.id));
    if (!workspace && base && inside(base, absolute)) workspace = await forThread(ctx.threadId);
    if (!workspace) workspace = allowed.find(holds);
    if (!workspace) return null;
    const real = await contained(workspace.folders, absolute);
    if (!(await stat(real)).isFile()) throw new Error(`${absolute} is a folder; name a file.`);
    const file = workspace.folders.some((folder) => inside(folder, absolute)) ? absolute : real;
    const name = relative(workspace.folders.find((folder) => inside(folder, file)) ?? dirname(file), file);
    return { workspace, file, name };
  };

  bb.agents.registerTool({
    name: "code_show",
    description:
      "Point the user at code: their VS Code opens the file, scrolls to the lines, selects and highlights them. Use it when you refer to specific code, so they see what you mean. path: full, or relative to your working folder. Lines are 1-based.",
    parameters: z.object({
      path: z.string().trim().min(1).max(4096),
      startLine: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
    }),
    execute: async ({ path, startLine, endLine }, ctx) => {
      const found = await target(path, ctx);
      if (!found) return `${path} isn't in this thread's worktree, so VS Code can't show it.`;
      const { workspace, file, name } = found;
      const start = startLine ?? 1;
      const end = Math.max(endLine ?? start, start);
      const where = `${name} ${start === end ? `line ${start}` : `lines ${start}–${end}`}`;
      if (showInEditor(workspace, file, start, end))
        return `Showing ${where} in the user's VS Code ("${workspace.title}").`;
      return `The user's VS Code for "${workspace.title}" isn't open. It will jump to ${where} when they open the VS Code tab.`;
    },
  });

  bb.agents.registerTool({
    name: "code_edit",
    description:
      "Edit a file live in the user's VS Code: they watch the text typed in, it merges with their unsaved changes, and it's one undo step for them. Prefer it over writing the file when they have it open, and always for files with unsaved changes. Each edit replaces oldText, which must appear exactly once (include enough around it), with newText; an empty oldText appends. With no editor open, the edits go to the file on disk.",
    parameters: z.object({
      path: z.string().trim().min(1).max(4096),
      edits: z.array(editSchema).min(1).max(20),
    }),
    execute: async ({ path, edits }, ctx) => {
      const found = await target(path, ctx);
      if (!found) return `${path} isn't in this thread's worktree or an open VS Code. Edit it with your own tools.`;
      const { workspace, file, name } = found;
      const result = await bridges.request(workspace.id, { type: "edit", path: file, edits }, EDIT_TIMEOUT_MS);
      const outcome = editOutcome(result);
      if (outcome === "done") {
        // Where BB's own events report edits, this one isn't among them: say it here.
        if (hostFileEvents) void deliver(ctx.threadId, { kind: "edit", path: file, added: edits.flatMap((edit) => edit.newText.split("\n")) }).catch(() => undefined);
        return result!.detail;
      }
      // An editor took the edit and failed, or didn't answer in time and may
      // still be typing: report it, never write the file as well.
      if (outcome === "fail") throw new Error(result!.detail);
      // No editor on screen: the same edits, on disk, unless an editor holds
      // unsaved changes to the file, which saving there would overwrite.
      if (bridges.unsaved(workspace.id).includes(file))
        throw new Error(`The user's editor has unsaved changes in ${name} but isn't on screen, so neither it nor the file on disk was changed. Ask them to open the VS Code tab, then try again.`);
      await editOnDisk(file, safeFolders(workspace), edits);
      return `No editor was open, so the ${edits.length === 1 ? "edit went" : `${edits.length} edits went`} to ${name} on disk.`;
    },
  });

  // ---- Watching the agent work (layer 2) -------------------------------------

  /** Thread titles, for "Fix the retry backoff: reading retry.ts". */
  const titles = new Map<string, string>();
  const titleOf = async (threadId: string) => {
    if (!titles.has(threadId)) {
      const thread = (await bb.sdk.threads.get({ threadId }).catch(() => null)) as { title?: string | null } | null;
      titles.set(threadId, thread?.title?.trim() || "Agent");
      cap(titles);
    }
    return titles.get(threadId)!;
  };
  /** The workspaces each thread's activity reached this turn, to tell them when it's done. */
  const touched = new Map<string, Set<string>>();
  forget = (threadId) => { titles.delete(threadId); touched.delete(threadId); };
  const deliver = async (threadId: string, activity: Activity) => {
    if (!bridges.anyConnected()) return;
    const by = await titleOf(threadId);
    bb.log.debug(`activity ${threadId}: ${activity.kind} ${"path" in activity ? activity.path : activity.state}`);
    if (activity.kind === "turn") {
      // The thread's own workspace, ones over its folder, and any its work reached.
      const path = await threadPath(threadId);
      const related = store.list()
        .filter((workspace) => !workspace.archived && (own(workspace, threadId) || (path !== null && workspace.folders.some((folder) => inside(folder, path) || inside(path, folder)))))
        .map((workspace) => workspace.id);
      const reached = new Set([...(touched.get(threadId) ?? []), ...related]);
      if (activity.state === "working") touched.set(threadId, new Set(related));
      else touched.delete(threadId);
      for (const id of reached) bridges.notify(id, { type: "activity", by, threadId, activity });
      return;
    }
    // Only editors holding the file hear about it: threads working elsewhere stay out.
    for (const workspace of store.list()) {
      if (workspace.archived || !bridges.connected(workspace.id) || !workspace.folders.some((folder) => inside(folder, activity.path))) continue;
      const sent = bridges.notify(workspace.id, { type: "activity", by, threadId, activity });
      bb.log.debug(`  -> ${workspace.id}: ${sent ? "sent" : "no window"}`);
      if (sent) {
        const reached = touched.get(threadId) ?? new Set<string>();
        reached.add(workspace.id);
        touched.set(threadId, reached);
      }
    }
  };
  const hasEditor = async (threadId: string) => {
    if (!bridges.anyConnected()) return false;
    const path = await threadPath(threadId);
    return relatedWorkspaces(store.list(), threadId, path, threadKeys.get(threadId) ?? null).some((workspace) => bridges.connected(workspace.id));
  };
  const warnActivity = (threadId: string) => (error: unknown) => bb.log.warn(`activity for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
  /**
   * An agent finished changing files (BB's `experimental_thread.fileChanged`):
   * every editor holding a file reloads it, where it has no unsaved edits,
   * and follow mode goes there as it does for an edit read from the events.
   */
  const filesChanged = async (threadId: string, changed: ThreadFileChange[]) => {
    if (!bridges.anyConnected()) return;
    for (const activity of fileChangeActivities(changed, await threadPath(threadId))) {
      for (const workspace of store.list()) {
        if (workspace.archived || !workspace.folders.some((folder) => inside(folder, activity.path))) continue;
        bridges.broadcast(workspace.id, { type: "refresh", path: activity.path });
      }
      await deliver(threadId, activity);
    }
  };
  /**
   * Where BB says when an agent changed a file, and when a turn starts and
   * ends, nothing reads the thread's events on a timer. A BB without the
   * event keeps the watcher below.
   */
  const hostFileEvents = listenForFileChanges(bb, (threadId, changed) => void filesChanged(threadId, changed).catch(warnActivity(threadId)));
  if (hostFileEvents) {
    bb.log.info("following agents' edits through BB's file-change event");
    for (const event of ["thread.idle", "thread.failed"] as const)
      bb.events.on(event, ({ thread }) => void deliver(thread.id, { kind: "turn", state: "done" }).catch(warnActivity(thread.id)));
  }
  const watcher = new ThreadWatcher({
    interested: hasEditor,
    events: async ({ threadId, afterSeq, order, limit }) => ({
      events: (await bb.sdk.threads.events.list({ threadId, limit, ...(afterSeq ? { afterSeq } : {}), ...(order ? { order } : {}) })) as unknown as { seq: number; type: string; data?: unknown }[],
    }),
    threadPath,
    status: async (threadId) => ((await bb.sdk.threads.get({ threadId })) as { status: string }).status,
    log: (message) => bb.log.info(message),
    onActivity: (threadId, activity) => void deliver(threadId, activity).catch(warnActivity(threadId)),
  });
  bb.onDispose(() => watcher.dispose());
  // Threads already working when an editor connects, after a plugin reload say,
  // would otherwise wait for their next turn to be followed.
  followWorking = (workspaceId) => {
    if (hostFileEvents) return;
    // The workspace's current thread: the VS Code tab beside it is how its work is watched.
    const threadId = store.reviewThread(workspaceId);
    if (!threadId || watcher.watching(threadId)) return;
    void bb.sdk.threads.get({ threadId }).then((thread) => {
      if ((thread as { status?: string }).status !== "active" || watcher.watching(threadId)) return;
      bb.log.info(`following thread ${threadId} while it works`);
      watcher.watch(threadId);
    }, () => undefined);
  };
  // Follow activity only while a related editor is connected.
  bb.events.on("thread.active", ({ thread }) => {
    if (hostFileEvents) {
      void deliver(thread.id, { kind: "turn", state: "working" }).catch(warnActivity(thread.id));
      return;
    }
    void hasEditor(thread.id).then((interested) => {
      if (!interested || watcher.watching(thread.id)) return;
      bb.log.info(`following thread ${thread.id} while it works`);
      watcher.watch(thread.id);
    });
  });

  // ---- Review comments (src/server/comments.ts) ------------------------------

  // Every window shows the workspace's comments, not only the one in use.
  const commentsChanged = (workspaceId: string) => bridges.broadcast(workspaceId, { type: "comments" });
  /** Where a review goes, with the thread's title for the editor to say. */
  const reviewTarget = async (workspaceId: string) => {
    const threadId = store.reviewThread(workspaceId);
    if (!threadId) return null;
    const thread = (await bb.sdk.threads.get({ threadId }).catch(() => null)) as { title?: string | null; archivedAt?: number | null } | null;
    if (!thread || thread.archivedAt) return null;
    return { threadId, title: thread.title?.trim() || "the chat" };
  };
  // ---- Asking from the editor (src/server/ask.ts) ---------------------------

  /** Tells BB's page with this editor in front to open something. */
  const openInBb = (workspaceId: string, open: EditorOpen) => bb.realtime.publish(CHANNEL, { type: "open", id: workspaceId, open });
  /** Where a new thread from this editor starts: the same worktree, else the same project. */
  const threadPlace = async (workspace: Workspace) => {
    const params = tabParamsOfKey(workspace.folderKey);
    const currentId = store.reviewThread(workspace.id);
    const current = currentId ? (await bb.sdk.threads.get({ threadId: currentId }).catch(() => null)) as { projectId?: string | null; environmentId?: string | null } | null : null;
    const projectId = (params && "projectId" in params ? params.projectId : null) ?? workspace.projectId ?? current?.projectId ?? null;
    const environmentId = params ? ("environmentId" in params ? params.environmentId : null) : current?.environmentId ?? null;
    return { projectId, environmentId };
  };
  const editorCall = async (workspaceId: string, call: EditorCall) => {
    const workspace = must(workspaceId);
    const file = resolve(call.path);
    const folder = workspace.folders.find((each) => inside(each, file));
    if (!folder) throw new Error("That file isn't in this workspace.");
    if (call.method === "showInBb") {
      const { environmentId } = await threadPlace(workspace);
      const hostId = environmentId ? null : (await bb.sdk.system.config()).primaryHostId;
      if (!environmentId && !hostId) throw new Error("BB can't show that file here.");
      openInBb(workspaceId, { kind: "file", line: call.line, target: environmentId ? { kind: "workspace", environmentId, path: relative(folder, file) } : { kind: "host", hostId: hostId!, path: file } });
      return { ok: true };
    }
    const text = selectionMessage({ question: call.question, shown: shown(file, workspace.folders), startLine: call.startLine, endLine: call.endLine, text: call.text, language: call.language });
    if (call.method === "ask") {
      const target = await reviewTarget(workspaceId);
      if (!target) throw new Error("Open this editor beside a chat first, so the question knows which thread to go to.");
      await bb.sdk.threads.send({ threadId: target.threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] } as never);
      return { sentTo: target.title };
    }
    const { projectId, environmentId } = await threadPlace(workspace);
    if (!projectId) throw new Error("Open this editor beside a chat first, so the new thread knows its project.");
    const thread = await bb.sdk.threads.spawn({
      projectId,
      environment: environmentId ? { type: "reuse", environmentId } : { type: "project-default" },
      input: [{ type: "text", text, mentions: [] }],
    } as never);
    openInBb(workspaceId, { kind: "thread", threadId: thread.id });
    return { threadId: thread.id };
  };

  const submitting = new Set<string>();
  commentCall = async (workspaceId, raw) => {
    if (isEditorCall(raw)) return editorCall(workspaceId, editorCallSchema.parse(raw));
    const call = commentCallSchema.parse(raw);
    const workspace = must(workspaceId);
    const list = async () => ({ threads: comments.threads(workspaceId), target: (await reviewTarget(workspaceId))?.title ?? null });
    switch (call.method) {
      case "list":
        return list();
      case "add": {
        const file = resolve(call.path);
        if (!workspace.folders.some((folder) => inside(folder, file))) throw new Error("That file isn't in this workspace.");
        comments.add(workspaceId, { ...call, path: file });
        break;
      }
      case "reply":
        if (comments.thread(call.threadId)?.workspaceId !== workspaceId) throw new Error("That comment thread is gone.");
        comments.reply(call.threadId, "user", call.body);
        break;
      case "edit":
        comments.edit(workspaceId, call.commentId, call.body);
        break;
      case "delete":
        comments.delete(workspaceId, call.commentId);
        break;
      case "resolve":
        if (comments.thread(call.threadId)?.workspaceId !== workspaceId) throw new Error("That comment thread is gone.");
        comments.resolve(call.threadId, call.resolved);
        break;
      case "submit": {
        if (submitting.has(workspaceId)) throw new Error("A review is already being submitted.");
        submitting.add(workspaceId);
        try {
          const items = comments.pending(workspaceId);
          if (!items.length) throw new Error("There are no comments to submit.");
          const target = await reviewTarget(workspaceId);
          if (!target) throw new Error("Open this editor beside a chat first, so the review knows which agent to go to.");
          const text = reviewMessage({ workspace: workspace.title, items, shown: (path) => shown(path, workspace.folders) });
          await bb.sdk.threads.send({ threadId: target.threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] } as never);
          comments.markSent(workspaceId, target.threadId, items);
          commentsChanged(workspaceId);
          return { ...(await list()), sent: items.length, sentTo: target.title };
        } finally { submitting.delete(workspaceId); }
      }
    }
    commentsChanged(workspaceId);
    return list();
  };

  const showIn = (workspaceId: string) => {
    const folders = store.get(workspaceId)?.folders ?? [];
    return (path: string) => shown(path, folders);
  };
  bb.agents.registerTool({
    name: "code_comments",
    description: "The user's open code review comments sent to you from VS Code (Studio Code): each thread's id, file and lines, and what was said.",
    parameters: z.object({}),
    execute: async (_input, ctx) => {
      const path = await threadPath(ctx.threadId);
      const open = comments.openFor(ctx.threadId).filter((thread) => {
        const workspace = store.get(thread.workspaceId);
        return workspace && usable(workspace, ctx.threadId, path);
      });
      return open.map((thread) => describeThread(thread, showIn(thread.workspaceId))).join("\n\n") || "No open review comments.";
    },
  });
  bb.agents.registerTool({
    name: "code_comment_reply",
    description: "Answer a code review comment in its thread in the user's VS Code: what you changed, or why not. resolve: true marks the thread done once it's addressed.",
    parameters: z.object({
      id: z.string().min(1).max(100).describe("The comment thread id, from the review message or code_comments."),
      body: z.string().trim().min(1).max(20_000).optional(),
      resolve: z.boolean().optional(),
    }),
    execute: async ({ id, body, resolve: done }, ctx) => {
      const thread = comments.thread(id);
      if (!thread || (thread.sentTo !== ctx.threadId && !comments.openFor(ctx.threadId).some((each) => each.id === id)))
        throw new Error("No review comment thread with that id was sent to you. code_comments lists yours.");
      const workspace = store.get(thread.workspaceId);
      if (!workspace || !usable(workspace, ctx.threadId, await threadPath(ctx.threadId)))
        throw new Error("That workspace is outside this thread's scope and sharing is off.");
      if (!body && done === undefined) throw new Error("Give a body, resolve, or both.");
      if (body) comments.reply(id, "agent", body, ctx.threadId);
      if (done !== undefined) comments.resolve(id, done);
      commentsChanged(thread.workspaceId);
      return `${body ? "Replied" : "Updated"}${done ? " and resolved" : ""} ${id} in the user's VS Code.`;
    },
  });

  const provider = codeProvider(store);
  registerCodeMentions(bb, store);
  return { store, provider };
}
