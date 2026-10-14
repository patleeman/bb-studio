// bb-studio-code — server entry.
//
// A workspace is Code's own (not a Studio item): a title, the project it
// belongs to, and the folders VS Code opens. Opening one starts code-server
// for it (src/server/runtime.ts); the app shows that editor in a frame.
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { defineItemMention, mustGet } from "@bb-studio/kit/server";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Activity } from "./src/server/activity";
import { Bridges, editorContext, shown } from "./src/server/bridge";
import { CommentStore, commentCallSchema, describeThread, reviewMessage } from "./src/server/comments";
import { installBridge } from "./src/server/bridge-extension";
import { editOnDisk, editOutcome, editSchema } from "./src/server/edits";
import { contained, listDir, readText } from "./src/server/files";
import { chipFor, relatedWorkspaces } from "./src/server/chip";
import { browseFolders, sensitiveFolder } from "./src/server/folders";
import { applyLayoutEverywhere, applyThemeEverywhere } from "./src/server/settings";
import type { BbTheme } from "./src/theme";
import { CodeServers } from "./src/server/runtime";
import { followWorktree, missingWorktreeMessage } from "./src/server/worktree-sync";
import { ThreadWatcher } from "./src/server/watch";
import { MIGRATIONS, WorkspaceStore } from "./src/server/store";
import { CHANNEL, codeContract, type Workspace } from "./src/shared";

/** Typing takes about 3 seconds an edit; allow for up to 20 of them. A window with no screen says so within 5. */
const EDIT_TIMEOUT_MS = 90_000;

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
  const comments = new CommentStore(db);
  // Workspaces are Code's own, not Studio items: a change tells Code's views only.
  const changes = { changed: (id: string) => { try { bb.realtime.publish(CHANNEL, { id }); } catch { /* Views refetch. */ } } };
  // <dataDir>/plugins/<id>/, beside the plugin's database.
  const root = dirname(db.name);
  /** BB's palette as the app last sent it; kept so new workspaces start in it. */
  let theme: BbTheme | null = null;
  let themeKey = "";
  void bb.storage.kv.get<BbTheme>("theme").then((saved) => { theme ??= saved ?? null; themeKey = JSON.stringify(theme); });
  // Existing workspaces get a new layout once, the next time VS Code loads.
  void applyLayoutEverywhere(root, (message) => bb.log.warn(message)).catch(() => undefined);
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
  void installBridge(join(root, "extensions")).catch((error) => bb.log.warn(`couldn't install the BB bridge extension: ${error instanceof Error ? error.message : String(error)}`));
  const servers = new CodeServers({
    root,
    log: bb.log,
    onChange: (id) => {
      bb.realtime.publish(CHANNEL, { id });
      const state = servers.status(id).state;
      if (state === "stopped" || state === "failed") void bridges.close(id);
    },
    theme: () => theme,
    env: async (id, dir) => ({ STUDIO_CODE_BRIDGE: await bridges.open(id, dir) }),
  });
  bb.onDispose(() => servers.dispose());
  bb.onDispose(() => bridges.closeAll());
  // A reload stopped every server; open views recheck and start theirs again.
  const reloaded = setTimeout(() => { try { bb.realtime.publish(CHANNEL, { id: "*" }); } catch { /* No views yet. */ } }, 1000);
  bb.onDispose(() => clearTimeout(reloaded));
  const must = (id: string) => mustGet((key) => store.get(key), id, "Workspace not found.");

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
    const folder = await threadFolder(threadId).catch((cause) => {
      // Without a current worktree to compare, keep the workspace the thread has.
      if (existing) return null;
      throw cause;
    });
    const checked = async (path: string) => {
      try {
        return await checkFolders([path]);
      } catch (cause) {
        if (!(await stat(path).catch(() => null))) throw new Error(missingWorktreeMessage(path));
        throw cause;
      }
    };
    if (existing) {
      if (!folder) return existing;
      const next = followWorktree(existing.folders, folder.path);
      if (next.length === existing.folders.length && next.every((each, i) => each === existing.folders[i])) return existing;
      await checked(folder.path);
      const moved = store.update(existing.id, { folders: next });
      await servers.sync(moved);
      changes.changed(moved.id);
      return moved;
    }
    if (!folder) throw new Error("This thread has no worktree or folder yet.");
    const workspace = store.create({ title: folder.title, projectId: folder.projectId, folders: await checked(folder.path), threadId });
    changes.changed(workspace.id);
    return workspace;
  };

  const projects = async () =>
    (await bb.sdk.projects.list({ includePersonal: true })).flatMap((project) => {
      const path = (project.sources.find((source) => source.isDefault) ?? project.sources[0])?.path;
      return path ? [{ id: project.id, name: project.name, path }] : [];
    });

  bb.rpc.register(codeContract, {
    get: ({ id }) => ({ workspace: store.get(id), status: servers.status(id) }),
    update: async ({ id, title, folders, share }) => {
      must(id);
      const workspace = store.update(id, {
        ...(share !== undefined ? { share } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(folders !== undefined ? { folders: await checkFolders(folders) } : {}),
      });
      if (folders !== undefined) await servers.sync(workspace);
      changes.changed(id);
      return { workspace };
    },
    open: async ({ id }) => {
      const workspace = must(id);
      store.markOpened(id);
      return { status: await servers.open(workspace) };
    },
    recent: async () => {
      const existing = store.recent();
      if (existing) return { workspace: existing };
      const project = (await projects())[0];
      const empty = store.list().find((workspace) => !workspace.archived);
      if (!project && empty) return { workspace: empty };
      const folders = project ? await checkFolders([project.path]).catch(() => []) : [];
      const workspace = store.create({ title: project?.name ?? "Workspace", projectId: project?.id ?? null, folders });
      changes.changed(workspace.id);
      return { workspace };
    },
    list: () => ({ workspaces: store.recentList() }),
    create: async ({ title, projectId }) => {
      const project = projectId ? (await projects()).find((candidate) => candidate.id === projectId) : undefined;
      const folders = project ? await checkFolders([project.path]).catch(() => []) : [];
      const workspace = store.create({ title: title ?? project?.name ?? "Workspace", projectId: project?.id ?? null, folders });
      store.markOpened(workspace.id);
      changes.changed(workspace.id);
      return { workspace };
    },
    archive: ({ id, archived }) => {
      must(id);
      if (archived) servers.stop(id);
      const workspace = store.update(id, { archived });
      changes.changed(id);
      return { workspace };
    },
    stop: ({ id }) => ({ status: servers.stop(must(id).id) }),
    threadWorkspace: ({ threadId }) => ({ workspace: store.forThread(threadId) ?? null }),
    forThread: async ({ threadId }) => ({ workspace: await forThread(threadId) }),
    listDir: async ({ id, path }) => {
      const folders = safeFolders(must(id));
      // The empty path lists the workspace's folders themselves.
      if (!path) return { entries: folders.map((folder) => ({ name: folder.split("/").filter(Boolean).at(-1) ?? folder, path: folder, dir: true })) };
      return { entries: await listDir(folders, path) };
    },
    readFile: async ({ id, path }) => readText(safeFolders(must(id)), path),
    browseFolders: ({ path, showHidden }) => browseFolders(path, homedir(), showHidden),
    viewedFrom: ({ id, threadId }) => { must(id); store.setReviewThread(id, threadId); return { ok: true as const }; },
    editorState: ({ id }) => ({ state: bridges.connected(id) ? bridges.state(id) : null }),
    threadChip: async ({ threadId }) => ({
      chip: chipFor({ threadId, threadPath: await threadPath(threadId), workspaces: store.list(), touched: touchedFiles.get(threadId) ?? null }),
    }),
    reveal: async ({ id, path, startLine, endLine }) => {
      const workspace = must(id);
      const file = isAbsolute(path) ? resolve(path) : resolve(workspace.folders[0] ?? "/", path);
      if (!workspace.folders.some((folder) => inside(folder, file))) throw new Error("That file isn't in this workspace.");
      await contained(safeFolders(workspace), file);
      return { shown: bridges.send(id, { type: "show", path: file, startLine, endLine: Math.max(endLine ?? startLine, startLine) }) };
    },
    projects: async () => ({ projects: await projects() }),
    syncTheme: async (next) => {
      const key = JSON.stringify(next);
      if (key === themeKey) return { changed: false };
      bb.log.info(`theme changed (${next.mode}, background ${next.colors.background}); open editors reload`);
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
    execute: async ({ id, folders }) => {
      untrust(must(id));
      const workspace = store.update(id, { folders: await checkFolders(folders) });
      await servers.sync(workspace);
      changes.changed(id);
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
  // ---- The agent and the user's editor --------------------------------------

  /** Per-thread caches keep their newest entries only. */
  const MAX_THREADS_KEPT = 500;
  const cap = <V>(map: Map<string, V>) => { while (map.size > MAX_THREADS_KEPT) map.delete(map.keys().next().value!); };
  /** Forgets a deleted or archived thread (set below, once its caches exist). */
  let forget: (threadId: string) => void = () => undefined;
  /** Each thread's working folder, refreshed when it starts a turn. */
  const threadPaths = new Map<string, string | null>();
  const threadPath = async (threadId: string): Promise<string | null> => {
    if (threadPaths.has(threadId)) return threadPaths.get(threadId)!;
    try {
      const thread = (await bb.sdk.threads.get({ threadId, include: "environment" })) as { environment?: { path: string | null } | null };
      const path = thread.environment?.path ?? null;
      threadPaths.set(threadId, path);
      cap(threadPaths);
      return path;
    } catch {
      return null;
    }
  };
  bb.events.on("thread.active", ({ thread }) => { threadPaths.delete(thread.id); void threadPath(thread.id); });
  for (const event of ["thread.deleted", "thread.archived"] as const)
    bb.events.on(event, ({ thread }) => { threadPaths.delete(thread.id); forget(thread.id); });

  const inside = (folder: string, path: string) => path === folder || path.startsWith(`${folder.replace(/\/+$/, "")}/`);
  /**
   * Workspaces with a VS Code open whose editor this thread may see: the one
   * made for it, or one whose folders hold its folder, with sharing on
   * (src/server/chip.ts, relatedWorkspaces).
   */
  const editorsFor = (threadId: string, _projectId: string | null, path: string | null) =>
    relatedWorkspaces(store.list(), threadId, path).filter((workspace) => bridges.connected(workspace.id) && bridges.state(workspace.id) !== null);
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
    execute: async (_input, ctx) => contextFor(ctx.threadId, ctx.projectId ?? null, await threadPath(ctx.threadId)) ?? "The user has no VS Code workspace open for this thread right now.",
  });

  /**
   * The workspace and file a tool means: an open editor of this thread's
   * first, then any open editor, then the thread's own worktree. The path is
   * checked through symlinks, but used as the workspace knows it: VS Code
   * treats /tmp/x and /private/tmp/x as two different files.
   */
  const target = async (path: string, ctx: { threadId: string; projectId?: string | null }) => {
    const base = await threadPath(ctx.threadId);
    const absolute = isAbsolute(path) ? resolve(path) : base ? resolve(base, path) : null;
    if (!absolute) throw new Error("Give a full path: this thread has no working folder to start from.");
    const holds = (workspace: Workspace) => !workspace.archived && workspace.folders.some((folder) => inside(folder, absolute));
    const mine = editorsFor(ctx.threadId, ctx.projectId ?? null, base);
    let workspace = mine.find(holds) ?? store.list().find((each) => holds(each) && bridges.connected(each.id));
    if (!workspace && base && inside(base, absolute)) workspace = await forThread(ctx.threadId);
    if (!workspace) workspace = store.list().find(holds);
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
      if (!found) return `None of the user's workspaces holds ${path}. Open one for its folder with code_workspace_open first.`;
      const { workspace, file, name } = found;
      const start = startLine ?? 1;
      const end = Math.max(endLine ?? start, start);
      const where = `${name} ${start === end ? `line ${start}` : `lines ${start}–${end}`}`;
      if (bridges.send(workspace.id, { type: "show", path: file, startLine: start, endLine: end }))
        return `Showing ${where} in the user's VS Code ("${workspace.title}").`;
      return `The user's VS Code for "${workspace.title}" isn't open. It will jump to ${where} when they open it.\n${card(workspace.id)}`;
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
      if (!found) return `None of the user's workspaces holds ${path}. Edit it with your own tools, or open a workspace for its folder with code_workspace_open first.`;
      const { workspace, file, name } = found;
      const result = await bridges.request(workspace.id, { type: "edit", path: file, edits }, EDIT_TIMEOUT_MS);
      const outcome = editOutcome(result);
      if (outcome === "done") {
        return result!.detail;
      }
      // An editor took the edit and failed, or didn't answer in time and may
      // still be typing: report it, never write the file as well.
      if (outcome === "fail") throw new Error(result!.detail);
      // No editor on screen: the same edits, on disk, unless an editor holds
      // unsaved changes to the file, which saving there would overwrite.
      if (bridges.unsaved(workspace.id).includes(file))
        throw new Error(`The user's editor has unsaved changes in ${name} but isn't on screen, so neither it nor the file on disk was changed. Ask them to open the workspace, then try again.`);
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
  /** Threads that have edited files in their folder or a workspace's: they get the header chip. */
  const touchedFiles = new Map<string, { working: boolean }>();
  forget = (threadId) => { titles.delete(threadId); touchedFiles.delete(threadId); touched.delete(threadId); };
  const chipChanged = (threadId: string) => { try { bb.realtime.publish(CHANNEL, { type: "thread", threadId }); } catch { /* No views. */ } };
  const deliver = async (threadId: string, activity: Activity) => {
    if (activity.kind === "turn" && activity.state === "done" && touchedFiles.get(threadId)?.working) {
      touchedFiles.set(threadId, { working: false });
      chipChanged(threadId);
    }
    if (activity.kind === "edit") {
      const path = await threadPath(threadId);
      const ours = (path !== null && inside(path, activity.path)) || store.list().some((workspace) => !workspace.archived && workspace.folders.some((folder) => inside(folder, activity.path)));
      if (ours && !touchedFiles.get(threadId)?.working) {
        touchedFiles.set(threadId, { working: true });
        cap(touchedFiles);
        chipChanged(threadId);
      }
    }
    if (!bridges.anyConnected()) return;
    const by = await titleOf(threadId);
    bb.log.debug(`activity ${threadId}: ${activity.kind} ${"path" in activity ? activity.path : activity.state}`);
    if (activity.kind === "turn") {
      // The thread's own workspace, ones over its folder, and any its work reached.
      const path = await threadPath(threadId);
      const related = store.list()
        .filter((workspace) => !workspace.archived && (workspace.threadId === threadId || (path !== null && workspace.folders.some((folder) => inside(folder, path) || inside(path, folder)))))
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
  const watcher = new ThreadWatcher({
    events: async ({ threadId, afterSeq, order, limit }) => ({
      events: (await bb.sdk.threads.events.list({ threadId, limit, ...(afterSeq ? { afterSeq } : {}), ...(order ? { order } : {}) })) as unknown as { seq: number; type: string; data?: unknown }[],
    }),
    threadPath,
    status: async (threadId) => ((await bb.sdk.threads.get({ threadId })) as { status: string }).status,
    log: (message) => bb.log.info(message),
    onActivity: (threadId, activity) => void deliver(threadId, activity).catch((error) => bb.log.warn(`activity for ${threadId}: ${error instanceof Error ? error.message : String(error)}`)),
  });
  bb.onDispose(() => watcher.dispose());
  // Threads already working when an editor connects, after a plugin reload say,
  // would otherwise wait for their next turn to be followed.
  followWorking = (workspaceId) => {
    // The workspace's own thread: a thread's VS Code tab is how its work is watched.
    const threadId = store.get(workspaceId)?.threadId;
    if (!threadId || watcher.watching(threadId)) return;
    void bb.sdk.threads.get({ threadId }).then((thread) => {
      if ((thread as { status?: string }).status !== "active" || watcher.watching(threadId)) return;
      bb.log.info(`following thread ${threadId} while it works`);
      watcher.watch(threadId);
    }, () => undefined);
  };
  // A thread is followed while it works, and only when an editor is open to show it.
  // Every working thread is followed (a cheap local poll while it works): its
  // edits light the header chip even before any editor is open.
  bb.events.on("thread.active", ({ thread }) => {
    if (watcher.watching(thread.id)) return;
    bb.log.info(`following thread ${thread.id} while it works`);
    watcher.watch(thread.id);
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
  commentCall = async (workspaceId, raw) => {
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
        const items = comments.pending(workspaceId);
        if (!items.length) throw new Error("There are no comments to submit.");
        const target = await reviewTarget(workspaceId);
        if (!target) throw new Error("Open this workspace beside a chat first (its VS Code tab), so the review knows which agent to go to.");
        const text = reviewMessage({ workspace: workspace.title, items, shown: (path) => shown(path, workspace.folders) });
        await bb.sdk.threads.send({ threadId: target.threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] } as never);
        comments.markSent(workspaceId, target.threadId);
        commentsChanged(workspaceId);
        return { ...(await list()), sent: items.length, sentTo: target.title };
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
    execute: (_input, ctx) => {
      const open = comments.openFor(ctx.threadId);
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
    execute: ({ id, body, resolve: done }, ctx) => {
      const thread = comments.thread(id);
      if (!thread || (thread.sentTo !== ctx.threadId && !comments.openFor(ctx.threadId).some((each) => each.id === id)))
        throw new Error("No review comment thread with that id was sent to you. code_comments lists yours.");
      if (!body && done === undefined) throw new Error("Give a body, resolve, or both.");
      if (body) comments.reply(id, "agent", body, ctx.threadId);
      if (done !== undefined) comments.resolve(id, done);
      commentsChanged(thread.workspaceId);
      return `${body ? "Replied" : "Updated"}${done ? " and resolved" : ""} ${id} in the user's VS Code.`;
    },
  });

  bb.agents.configure(() => ({
    tools: ["code_workspaces_list", "code_workspace_open", "code_workspace_set_folders", "code_editor_state", "code_show", "code_edit", "code_comments", "code_comment_reply"],
    skills: ["studio-code"],
  }));
}
