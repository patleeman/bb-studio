import { subcommand, takeFlag, takeOption, usage } from "@bb-studio/kit/cli";
import { defineItemMention, serveBytes, studioServices } from "@bb-studio/kit/server";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { studioSchemas } from "@bb-studio/kit/contract";
import { untitled } from "@bb-studio/kit/format";
import { pageCheckboxes } from "@bb-studio/kit/page-checkbox";
import { createStudioNotifier } from "@bb-studio/kit/server";
import * as Y from "yjs";
import { z } from "zod";
import { actorColor, BotDirectory } from "./src/bots";
import { FILES_PATH, HUMAN_USER_ID, MAX_UPLOAD_BYTES, MERMAID_PATH, PLUGIN_ID, PLUGIN_RPC_ACTOR, SYNC_PATH, UPLOAD_PATH } from "./src/constants";
import { rpcContract } from "./src/contract";
import { studioEmbeds } from "./src/embeds";
import { fetchPreview } from "./src/unfurl";
import { createThread, listThreads, reply, setResolved } from "./src/comments";
import { applyEdits, readMarkdown, textBlocks } from "./src/doc";
import type { Socket } from "./src/hub";
import { errorText, pageUrl, PagesService, requestView, toView, truncate, validateCron } from "./src/service";
import { MIGRATIONS, PageStore } from "./src/store";
import { registerStudio } from "./src/studio";
import { outgoingStudioLinks } from "./src/studio-links";
import { agentConfiguration, registerTools } from "./src/tools";

const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|ogg)|audio\/(mpeg|mp4|ogg|wav|webm)|application\/pdf)$/;

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new PageStore(db);
  const bots = new BotDirectory(bb);
  const service = new PagesService(bb, store, bots);

  // Live sync -----------------------------------------------------------------

  const sockets = new WeakMap<object, { pageId: string; socket: Socket }>();
  bb.http.experimental_websocket(
    SYNC_PATH,
    ({ url }) => {
      const pageId = url.searchParams.get("page") ?? "";
      return {
        onOpen(ws) {
          if (!store.meta(pageId)) {
            ws.close(4404, "Page not found");
            return;
          }
          const socket: Socket = {
            send: (data) => ws.readyState === 1 && ws.send(data),
            close: (code, reason) => ws.close(code, reason),
          };
          sockets.set(ws, { pageId, socket });
          service.hub.connect(pageId, socket);
        },
        onMessage(ws, data) {
          const entry = sockets.get(ws);
          if (!entry || typeof data === "string") return;
          try {
            service.hub.receive(entry.pageId, entry.socket, data);
          } catch (error) {
            bb.log.warn(`Dropping a bad sync message for ${entry.pageId}: ${errorText(error)}`);
          }
        },
        onClose(ws) {
          const entry = sockets.get(ws);
          if (!entry) return;
          sockets.delete(ws);
          service.hub.disconnect(entry.pageId, entry.socket);
        },
      };
    },
    { auth: "local" },
  );

  // Files ---------------------------------------------------------------------

  bb.http.route(
    "POST",
    UPLOAD_PATH,
    async (c) => {
      const body = (await c.req.json().catch(() => null)) as {
        pageId?: unknown;
        name?: unknown;
        mime?: unknown;
        dataBase64?: unknown;
      } | null;
      if (!body || typeof body.pageId !== "string" || typeof body.dataBase64 !== "string") {
        return c.json({ error: "Expected { pageId, name, mime, dataBase64 }." }, 400);
      }
      if (!store.meta(body.pageId)) return c.json({ error: "Page not found." }, 404);
      const data = Buffer.from(body.dataBase64, "base64");
      if (!data.length) return c.json({ error: "The file is empty." }, 400);
      if (data.length > MAX_UPLOAD_BYTES) return c.json({ error: "Files are limited to 15 MB." }, 413);
      const name = typeof body.name === "string" && body.name ? body.name.slice(0, 200) : "file";
      const mime = typeof body.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(body.mime) ? body.mime : "application/octet-stream";
      const id = store.addFile(body.pageId, name, mime, data);
      return c.json({ id, url: `/api/v1/plugins/${PLUGIN_ID}/http${FILES_PATH}?id=${id}` });
    },
    { auth: "local" },
  );

  bb.http.route(
    "GET",
    FILES_PATH,
    (c) => {
      const file = store.file(c.req.query("id") ?? "");
      if (!file) return c.text("Not found", 404);
      const inline = INLINE_MIME.test(file.mime);
      return serveBytes(new Uint8Array(file.data), {
        "content-type": inline ? file.mime : "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${file.name.replace(/["\\\r\n]/g, "_")}"`,
        "content-security-policy": "sandbox",
      });
    },
    { auth: "local" },
  );

  // Mermaid's browser build is 3.5 MB, so it isn't in the app bundle every
  // window loads; the editor fetches it the first time a page shows a diagram.
  let mermaidScript: Promise<string> | null = null;
  bb.http.route(
    "GET",
    MERMAID_PATH,
    async (c) => {
      mermaidScript ??= readFile(createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js"), "utf8");
      try {
        return new Response(await mermaidScript, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "private, max-age=86400",
            "x-content-type-options": "nosniff",
          },
        });
      } catch (error) {
        mermaidScript = null;
        bb.log.warn(`Mermaid's browser build is missing: ${errorText(error)}`);
        return c.text("Mermaid isn't installed with Pages.", 404);
      }
    },
    { auth: "local" },
  );

  // RPC -----------------------------------------------------------------------

  const requireMeta = (id: string) => {
    const meta = store.meta(id);
    if (!meta) throw new Error("Page not found.");
    return meta;
  };

  // Comment RPCs write as the user. A non-string origin is what the hub and
  // the bot watcher treat as a human edit, like an editor socket's.
  const CLIENT_ORIGIN = { client: "rpc" };
  const authorNames = async (authors: string[]) => {
    const names = new Map<string, string>();
    const unique = [...new Set(authors)];
    const directory = unique.some((author) => author.startsWith("bot:")) ? await bots.list().catch(() => null) : null;
    for (const author of unique) {
      if (author === HUMAN_USER_ID) names.set(author, "You");
      else if (author.startsWith("bot:")) names.set(author, directory?.bots.find((bot) => `bot:${bot.id}` === author)?.name ?? "Bot");
      else if (author.startsWith("agent:thr_")) names.set(author, (await service.actorForThread(author.slice(6))).actor.name);
    }
    return names;
  };

  const studio = studioSchemas(z);
  const embeds = studioEmbeds(bb.sdk, studio);

  bb.rpc.register(rpcContract, {
    tree: ({ projectId }) => ({ pages: store.list({ projectId, includeArchived: true }).map(toView) }),
    create: (input) => ({ page: toView(service.createPage({ ...input, actor: HUMAN_USER_ID })) }),
    update: ({ id, title, icon, parentId, projectId, position, archived }) => {
      const meta = requireMeta(id);
      let nextProject = projectId === undefined ? meta.project_id : projectId;
      if (parentId) {
        if (parentId === id || store.descendants(id).includes(parentId)) throw new Error("A page can't be nested inside itself.");
        nextProject = requireMeta(parentId).project_id;
      }
      const page = store.update(
        id,
        {
          title,
          icon,
          parent_id: parentId,
          project_id: nextProject,
          position,
          archived_at: archived === undefined ? undefined : archived ? Date.now() : null,
        },
        HUMAN_USER_ID,
      )!;
      if (nextProject !== meta.project_id) {
        for (const child of store.descendants(id)) store.update(child, { project_id: nextProject }, HUMAN_USER_ID);
      }
      service.publish({ type: "tree", projectId: meta.project_id });
      if (nextProject !== meta.project_id) service.publish({ type: "tree", projectId: nextProject });
      return { page: toView(page) };
    },
    remove: ({ id }) => {
      requireMeta(id);
      return { deleted: service.deletePage(id) };
    },
    get: ({ id }) => {
      const meta = store.meta(id);
      return { page: meta ? toView(meta) : null };
    },
    linkPreview: ({ url }) => fetchPreview(url),
    studioItems: async () => ({ items: await embeds.items() }),
    artifactView: async ({ id }) => ({ view: await embeds.artifactView(id) }),
    studioCreate: async ({ pageId, pluginId, kind }) => ({ item: await embeds.create(pluginId, kind, requireMeta(pageId).project_id) }),
    tableGet: ({ id }) => embeds.table("get", { id }),
    tableUpdate: (input) => embeds.table("update", input),
    tablePatchRows: (input) => embeds.table("patchRows", input),
    tableCreate: ({ pageId, ...input }) => embeds.createTable({ ...input, projectId: requireMeta(pageId).project_id }),
    taskView: ({ id }) => embeds.task(id),
    taskUpdate: (input) => embeds.updateTask(input),
    boardView: ({ id }) => embeds.board(id),
    boardRename: ({ id, title }) => embeds.renameBoard(id, title),
    boardTaskCreate: ({ boardId, title, status }) => embeds.createBoardTask(boardId, title, status),
    recordingView: async ({ id }) => ({ recording: await embeds.recording(id) }),
    spaceView: async ({ id }) => ({ view: await embeds.space(id) }),
    spaceOfPage: async ({ id }) => ({ space: await embeds.spaceOfPage(id) }),
    spaceCreate: ({ id, pluginId, kind }) => embeds.createInSpace(id, pluginId, kind),
    markdown: ({ id }) => {
      requireMeta(id);
      return { markdown: readMarkdown(service.hub.open(id).doc) };
    },
    editableMarkdown: ({ id }) => {
      requireMeta(id);
      return { markdown: readMarkdown(service.hub.open(id).doc, { ids: true }) };
    },
    taskFromCheckbox: async ({ id, blockId }) => {
      const meta = store.meta(id);
      if (!meta) throw new Error("Page not found.");
      const expected = readMarkdown(service.hub.open(id).doc, { ids: true });
      const checkbox = pageCheckboxes(expected).find((row) => row.blockId === blockId.replace(/-/g, "").slice(0, 8));
      if (!checkbox) throw new Error("Select a checkbox block first.");
      if (checkbox.taskId) throw new Error("This checkbox already has a task.");
      const result = await bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "create",
        input: { title: checkbox.title, projectId: meta.project_id, status: checkbox.checked ? "done" : "todo" } as never,
        outputSchema: z.object({ task: z.object({ id: z.string() }) }) });
      try {
        await bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "link",
          input: { id: result.task.id, link: { target: "item", pluginId: "pages", itemId: id, label: meta.title || "Page", href: `${pageUrl(id)}#${checkbox.blockId}` } } as never,
          outputSchema: z.object({ ok: z.boolean() }) });
        service.editClientBlock(id, expected, checkbox.blockId, `${checkbox.line} [Task](item:studio-tasks:${result.task.id})`);
      } catch (error) {
        await bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "delete", input: { id: result.task.id } as never, outputSchema: z.object({ ok: z.boolean() }) }).catch(() => {});
        throw error;
      }
      return { taskId: result.task.id };
    },
    editBlock: ({ id, expected, block, markdown }) => {
      return { markdown: service.editClientBlock(id, expected, block, markdown) };
    },
    editDocument: ({ id, expected, markdown }) => ({ markdown: service.editClientDocument(id, expected, markdown) }),
    replaceMarkdown: ({ id, markdown, snapshotName }) => {
      requireMeta(id);
      const actor = { key: PLUGIN_RPC_ACTOR, name: "Agent", color: actorColor(PLUGIN_RPC_ACTOR) };
      return { page: toView(service.replaceMarkdown(id, markdown, snapshotName, actor)) };
    },
    search: ({ query, projectId }) => ({ pages: store.search(query, projectId).map(toView) }),
    bots: async () => {
      const result = await bots.list();
      return {
        available: result.available,
        reason: result.available ? null : result.reason,
        bots: result.bots.map(({ id, name, handle, avatar, description, working }) => ({ id, name, handle, avatar, description, working })),
      };
    },
    requests: ({ pageId }) => ({ requests: store.requests(pageId).map(requestView) }),
    setRefresh: async ({ id, refresh }) => {
      requireMeta(id);
      if (refresh) {
        const problem = validateCron(refresh.cron);
        if (problem) throw new Error(`Invalid schedule: ${problem}`);
        if (!(await bots.get(refresh.botId))) throw new Error("That bot isn't available in Studio Teams.");
      }
      store.setRefresh(id, refresh);
      // A new schedule counts from now rather than firing for past slots.
      if (refresh) store.markRefreshed(id, Date.now());
      service.publish({ type: "page", pageId: id });
      return { page: toView(requireMeta(id)) };
    },
    refreshNow: async ({ id }) => {
      const request = await service.refresh(requireMeta(id), "manual");
      if (!request) throw new Error("A refresh is already queued.");
      return { request: requestView(request) };
    },
    work: async ({ id, request }) => {
      const meta = requireMeta(id);
      const message = request.input
        .map((item) => (item.type === "text" && item.visibility !== "agent-only" ? item.text : ""))
        .join("\n")
        .trim();
      // An @mentioned bot takes the work in its own thread; otherwise a plain
      // agent does, so the composer works without Studio Teams.
      const [bot] = message ? await bots.mentionedIn(message).catch(() => []) : [];
      if (bot) {
        const row = await service.dispatch(id, bot, "mention", {
          dedupeKey: `work:${id}:${bot.id}:${Date.now()}`,
          summary: truncate(message, 140),
          prompt: service.requestPrompt(meta, ["The user asked you about a page:", message, "", "Make any page changes with pages_edit."]),
        });
        if (!row?.thread_id || row.status === "failed") throw new Error(row?.error ?? `Couldn't reach ${bot.name}.`);
        const at = Date.now();
        void services.linkThread({ threadId: row.thread_id, ref: { pluginId: PLUGIN_ID, id }, role: "work", state: "working", createdAt: at, updatedAt: at, metadata: { botId: bot.id } }).catch(() => { /* Studio is optional. */ });
        service.publish({ type: "chats", pageId: id, threadId: row.thread_id });
        return { threadId: row.thread_id, botName: bot.name };
      }
      const markdown = readMarkdown(service.hub.open(id).doc, { ids: true });
      const thread = await bb.sdk.threads.spawn({
        ...request,
        input: [
          ...request.input,
          {
            type: "text",
            visibility: "agent-only",
            mentions: [],
            text: service.requestPrompt(meta, [
              "The user is working with you from a page. Their message is about this page.",
              "Current page with block ids:",
              truncate(markdown, 40_000),
            ]),
          },
        ],
      });
      store.addChat(id, thread.id);
      service.publish({ type: "chats", pageId: id, threadId: thread.id });
      const at = Date.now();
      void services.linkThread({ threadId: thread.id, ref: { pluginId: PLUGIN_ID, id }, role: "chat", state: "working", createdAt: at, updatedAt: at, metadata: {} }).catch(() => { /* Studio is optional. */ });
      return { threadId: thread.id, botName: null };
    },
    chats: async ({ pageId }) => {
      // Skips chats whose thread was deleted; the row stays in case the lookup failed for another reason.
      const rows = await Promise.all(
        store.chats(pageId).map(async (row) =>
          (await bb.sdk.threads.get({ threadId: row.thread_id }).then(() => true, () => false))
            ? { threadId: row.thread_id, createdAt: row.created_at }
            : null,
        ),
      );
      return { chats: rows.filter((chat) => chat !== null) };
    },
    chatPage: ({ threadId }) => {
      const id = store.chatPageId(threadId);
      const meta = id ? store.meta(id) : null;
      return { page: meta ? toView(meta) : null };
    },
    snapshots: ({ id }) => ({
      snapshots: store.snapshots(id).map((row) => ({ id: row.id, label: row.label, actor: row.actor, createdAt: row.created_at })),
    }),
    snapshotBytes: ({ id, snapshotId }) => {
      const snapshot = store.snapshotState(snapshotId);
      return { bytes: snapshot?.page_id === id ? snapshot.state.toString("base64") : null };
    },
    snapshot: ({ id, label }) => {
      requireMeta(id);
      const row = store.addSnapshot(id, Y.encodeStateAsUpdate(service.hub.open(id).doc), label?.trim() || "Saved version", HUMAN_USER_ID);
      return { snapshot: { id: row.id, label: row.label, actor: row.actor, createdAt: row.created_at } };
    },
    restore: ({ snapshotId }) => ({ ok: service.restore(snapshotId, HUMAN_USER_ID) }),
    comments: async ({ id, includeResolved }) => {
      requireMeta(id);
      const threads = listThreads(service.hub.open(id).doc, { includeResolved });
      const names = await authorNames(threads.flatMap((thread) => thread.comments.map((comment) => comment.author)));
      return {
        threads: threads.map((thread) => ({
          ...thread,
          comments: thread.comments.map((comment) => ({ ...comment, authorName: names.get(comment.author) ?? "Agent" })),
        })),
      };
    },
    commentBlocks: ({ id }) => {
      requireMeta(id);
      return { blocks: textBlocks(service.hub.open(id).doc) };
    },
    commentCreate: async ({ id, block, quote, text }) => {
      requireMeta(id);
      const { threadId } = await createThread(service.hub.open(id).doc, HUMAN_USER_ID, { block, quote, text }, CLIENT_ORIGIN);
      return { threadId };
    },
    commentReply: ({ id, thread, text }) => {
      requireMeta(id);
      reply(service.hub.open(id).doc, HUMAN_USER_ID, thread, text, CLIENT_ORIGIN);
      return { ok: true };
    },
    commentResolve: ({ id, thread, resolved }) => {
      requireMeta(id);
      setResolved(service.hub.open(id).doc, HUMAN_USER_ID, thread, resolved, CLIENT_ORIGIN);
      return { ok: true };
    },
  });

  // Studio --------------------------------------------------------------------

  registerStudio(bb, service, studio);
  // Typing saves a page every few seconds; Studio only needs to hear about it now and then.
  const studioNotifier = createStudioNotifier({ plugins: bb.sdk.plugins, pluginId: PLUGIN_ID, schemas: studio, delayMs: 1500 });
  const services = studioServices(bb.sdk);
  for (const page of store.list({ includeArchived: true })) {
    for (const chat of store.chats(page.id, 1000)) void services.linkThread({
      threadId: chat.thread_id, ref: { pluginId: PLUGIN_ID, id: page.id }, role: "chat", state: "idle",
      createdAt: chat.created_at, updatedAt: chat.created_at, metadata: {},
    }).catch(() => { /* Studio is optional. */ });
  }
  const syncLinks = (id: string) => {
    const ref = { pluginId: PLUGIN_ID, id };
    const markdown = store.meta(id) ? readMarkdown(service.hub.open(id).doc) : "";
    void services.replaceLinks(ref, PLUGIN_ID, outgoingStudioLinks(id, markdown)).catch(() => { /* Studio is optional. */ });
  };
  service.onPublish = (event) => {
    if (event.type === "page") {
      studioNotifier.changed(event.pageId); syncLinks(event.pageId);
      const markdown = readMarkdown(service.hub.open(event.pageId).doc, { ids: true });
      for (const checkbox of pageCheckboxes(markdown).filter((row) => row.taskId).slice(0, 100)) {
        void bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "syncCheckbox",
          input: { id: checkbox.taskId!, checked: checkbox.checked } as never,
          outputSchema: z.object({ ok: z.boolean() }) }).catch(() => { /* Tasks may not be installed. */ });
      }
      const meta = store.meta(event.pageId);
      if (meta) void services.recordActivity({
        ref: { pluginId: PLUGIN_ID, id: event.pageId },
        actor: meta.updated_by.startsWith("bot:") ? { kind: "bot", id: meta.updated_by.slice(4) } : meta.updated_by.startsWith("agent:") ? { kind: "agent", id: meta.updated_by.slice(6) } : { kind: "user" },
        verb: "updated", at: meta.updated_at, summary: meta.title || "Untitled page",
      }).catch(() => { /* Studio is optional. */ });
    }
    else if (event.type === "deleted") for (const id of event.pageIds) { studioNotifier.changed(id); syncLinks(id); }
    else studioNotifier.changed();
  };

  // Agents --------------------------------------------------------------------

  const created = (id: string, threadId: string) => void services.created({ pluginId: PLUGIN_ID, id }, threadId).catch(() => { /* Studio is optional. */ });
  registerTools(bb, service, created);
  bb.agents.configure(() => agentConfiguration());

  bb.ui.registerMentionProvider(defineItemMention({
    id: "page",
    label: "Pages",
    search({ query, projectId }) {
      const pages = query.trim() ? store.search(query, projectId) : store.list({ projectId }).slice(0, 20);
      return pages.map((page) => ({
        id: page.id,
        title: `${page.icon ? `${page.icon} ` : ""}${untitled(page.title)}`,
        subtitle: page.project_id ? "Page" : "Global page",
        icon: "FileText",
      }));
    },
    resolve(itemId) {
      const meta = requireMeta(itemId);
      const markdown = readMarkdown(service.hub.open(itemId).doc, { ids: true });
      return {
        context: [
          `The user referenced the BB Page "${untitled(meta.title)}" (id ${meta.id}, ${pageUrl(meta.id)}). Current content with block ids:`,
          "",
          truncate(markdown, 40_000),
          "",
          "Use pages_read for the latest version and pages_edit to change it.",
        ].join("\n"),
      };
    },
  }));

  bb.cli.register({
    name: "pages",
    summary: "Read and write BB Pages (collaborative documents)",
    commands: [
      { name: "list", summary: "List pages in the current project and global pages", usage: "bb pages list [--all]" },
      { name: "show", summary: "Print a page (id or title) as Markdown", usage: "bb pages show <page-id> [--ids]" },
      { name: "create", summary: "Create a page from a title and optional Markdown", usage: "bb pages create <title> [--global] [--markdown <text>]" },
      { name: "append", summary: "Append Markdown to a page", usage: "bb pages append <page-id> <markdown…>" },
    ],
    async run(argv, ctx) {
      const { command, rest } = subcommand(argv);
      const flag = (name: string) => takeFlag(rest, name);
      const option = (name: string) => takeOption(rest, name);
      try {
        switch (command) {
          case "list": {
            const pages = store.list(flag("--all") ? {} : { projectId: ctx.projectId ?? null });
            if (!pages.length) return { exitCode: 0, stdout: "No pages.\n" };
            const lines = pages.map(
              (page) => `${page.id}\t${untitled(page.title)}\t${page.project_id ?? "global"}\t${new Date(page.updated_at).toISOString()}`,
            );
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "show": {
            const ids = flag("--ids") === true;
            const meta = service.requirePage(rest.join(" "), ctx.projectId);
            return { exitCode: 0, stdout: readMarkdown(service.hub.open(meta.id).doc, { ids }) };
          }
          case "create": {
            const global = flag("--global") === true;
            const markdown = option("--markdown")?.replace(/\\n/g, "\n");
            const title = rest.join(" ").trim();
            if (!title) return { exitCode: 1, stderr: "usage: bb pages create <title> [--global] [--markdown <text>]\n" };
            const page = service.createPage({
              projectId: global ? null : (ctx.projectId ?? null),
              parentId: null,
              title,
              markdown,
              actor: ctx.threadId ? `agent:${ctx.threadId}` : HUMAN_USER_ID,
            });
            if (ctx.threadId) created(page.id, ctx.threadId);
            return { exitCode: 0, stdout: `${page.id}\n` };
          }
          case "append": {
            const [ref, ...words] = rest;
            const markdown = words.join(" ").replace(/\\n/g, "\n");
            if (!ref || !markdown.trim()) return { exitCode: 1, stderr: "usage: bb pages append <page-id> <markdown…>\n" };
            const meta = service.requirePage(ref, ctx.projectId);
            const origin = ctx.threadId ? `agent:${ctx.threadId}` : "cli";
            applyEdits(service.hub.open(meta.id).doc, [{ op: "append", markdown }], origin);
            return { exitCode: 0, stdout: `Appended to ${meta.id}.\n` };
          }
          default:
            return usage("bb pages <list|show|create|append> …");
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  });

  // Bot request lifecycle -----------------------------------------------------

  bb.events.on("thread.active", ({ thread }) => service.onThreadActive(thread.id));
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) =>
    service.onThreadSettled(thread.id, { failed: false, text: lastAssistantText }),
  );
  bb.events.on("thread.failed", ({ thread, error }) => service.onThreadSettled(thread.id, { failed: true, text: error }));

  bb.background.schedule("pages-refresh", "* * * * *", () => service.runDueRefreshes());

  bb.onDispose(() => {
    studioNotifier.dispose();
    service.onPublish = null;
    service.hub.flushAll();
    service.dispose();
  });
}
