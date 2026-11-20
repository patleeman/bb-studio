import { untitled } from "../kit/format";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createThread, listThreads, reply, setResolved, type ThreadView } from "./comments";
import { readMarkdown, type EditOp } from "./doc";
import { shortId } from "./markdown";
import { threadImageReader } from "./local-image-reader";
import { skippedNote } from "./local-images";
import { errorText, pageUrl, truncate, type PagesService } from "./service";
import type { PageMeta } from "./store";
import { opNeeds } from "../op-errors";

const MAX_READ_CHARS = 60_000;

export const TOOL_NAMES = [
  "pages_list",
  "pages_read",
  "pages_create",
  "pages_edit",
  "pages_comments",
] as const;

export const AGENT_INSTRUCTIONS = [
  "BB Pages are collaborative documents the user edits live. Read a page with pages_read before changing it; it returns Markdown with a `<!-- ^id -->` marker on the line before each block, naming the block below it.",
  "Edit with pages_edit using small, targeted operations that reference those block ids, so you don't overwrite the user's concurrent typing. Use replace_all only when asked to rewrite a whole page.",
  "Pages Markdown supports GFM plus: ```chart / ```stats / ```embed fenced JSON blocks, ```mermaid diagrams, ```html blocks, `> [!NOTE]` callouts (NOTE, TIP, WARNING, CAUTION, IMPORTANT), `<details><summary>Title</summary>` … `</details>` toggles (a `## ` summary makes a toggle heading), and mentions like @[Title](page:pg_id), @[Title](item:plugin:id), @[2026-10-01](date:2026-10-01).",
  'Chart JSON: {"type":"bar|line|area|pie","title":"…","x":"label","series":["Revenue"],"unit":"$","data":[{"label":"Q1","Revenue":10}]}. Stats JSON: [{"label":"ARR","value":"$1.2M","delta":"+8%","trend":"up"}] (1–6 items). Embed JSON: {"kind":"bookmark|thread|page|drawing|artifact|recording|mini|table|item","target":"https://… or an id","title":"…"}; item targets are plugin:id from studio_list_items; a table target may be <table id>/view/<view id>; a drawing (whiteboard) embed may set "height" in pixels (160–1200).',
  "An ```html block renders its HTML in a sandboxed iframe: scripts run, but with no same-origin access (no cookies, storage or BB APIs), and don't assume network access. Keep it self-contained with inline <style> and <script>, follow light and dark with prefers-color-scheme, and keep it under 200,000 characters (longer ones show as code). Use ```html only for something to render; show HTML source as code with ```html source (or another language such as ```xml).",
  "Images: prefer an artifact embed (save the image as an artifact, then ```embed {\"kind\":\"artifact\",\"target\":\"art_…\"}). Local image paths (`![](/…/chart.png)`) are imported into the page when supported: PNG, JPEG, GIF or WebP up to 10 MB from your thread's workspace or thread storage. The tool result names any image it couldn't import.",
  "Manage page comments with pages_comments (op: list, create, reply, resolve): answer in the same thread with op \"reply\"; start new threads with op \"create\" on the block/quote you are discussing.",
  'When you create or change a page, put its card on its own line in your reply, `::page{id="pg_…"}`, so the user can open it beside the chat.',
].join("\n");

const ref = z.string().min(1).describe("Page id (pg_…) or title");
const block = z.string().min(4).describe("Block id or 8-char prefix");

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("insert_after"), block, markdown: z.string() }),
  z.object({ op: z.literal("insert_before"), block, markdown: z.string() }),
  z.object({ op: z.literal("replace"), block, markdown: z.string() }),
  z.object({ op: z.literal("append"), markdown: z.string() }),
  z.object({ op: z.literal("prepend"), markdown: z.string() }),
  z.object({ op: z.literal("delete"), block }),
  z.object({ op: z.literal("set_checked"), block, checked: z.boolean() }),
  z.object({
    op: z.literal("replace_text"),
    block: block.optional(),
    find: z.string().min(1),
    replace: z.string(),
  }),
  z.object({ op: z.literal("replace_all"), markdown: z.string() }),
]);

/** The reply card that opens a page in the user's workbench. */
export const pageCard = (id: string) => `Put this line on its own in your reply so the user can open the page beside the chat:\n::page{id="${id}"}`;

/**
 * `created` tells Studio an agent made a page, so it joins the thread's
 * spaces; `edited` links a page an agent changed to its thread.
 */
export function registerTools(
  bb: BbPluginApi,
  service: PagesService,
  created: (pageId: string, threadId: string) => void = () => {},
  edited: (pageId: string, threadId: string) => void = () => {},
): void {
  const { store } = service;

  const pageLine = (page: PageMeta, depth = 0) =>
    `${"  ".repeat(depth)}- ${page.icon ? `${page.icon} ` : ""}${untitled(page.title)} (id ${page.id}${page.project_id ? "" : ", global"})`;

  bb.agents.registerTool({
    name: "pages_list",
    description: "List BB Pages (collaborative documents) in this project and global pages, as a tree. Optionally search titles and content.",
    parameters: z.object({ query: z.string().max(200).optional() }),
    execute({ query }, ctx) {
      if (query?.trim()) {
        const hits = store.search(query, ctx.projectId);
        return hits.length ? hits.map((page) => pageLine(page)).join("\n") : `No pages match "${query}".`;
      }
      const pages = store.list({ projectId: ctx.projectId });
      if (!pages.length) return "No pages yet. Create one with pages_create.";
      const children = new Map<string | null, PageMeta[]>();
      for (const page of pages) {
        const parent = page.parent_id && pages.some((p) => p.id === page.parent_id) ? page.parent_id : null;
        children.set(parent, [...(children.get(parent) ?? []), page]);
      }
      const lines: string[] = [];
      const walk = (parent: string | null, depth: number) => {
        for (const page of children.get(parent) ?? []) {
          lines.push(pageLine(page, depth));
          walk(page.id, depth + 1);
        }
      };
      walk(null, 0);
      return lines.join("\n");
    },
  });

  bb.agents.registerTool({
    name: "pages_read",
    description: "Read a BB Page as Markdown with `<!-- ^id -->` block ids and open comments. Read right before pages_edit.",
    parameters: z.object({ page: ref }),
    execute({ page }, ctx) {
      const meta = service.requirePage(page, ctx.projectId);
      const live = service.hub.open(meta.id);
      const markdown = readMarkdown(live.doc, { ids: true });
      const threads = listThreads(live.doc);
      return truncate(
        [
          `# ${meta.icon ? `${meta.icon} ` : ""}${untitled(meta.title)}`,
          `Page id ${meta.id} · ${meta.project_id ? "project page" : "global page"} · ${pageUrl(meta.id)}`,
          "",
          markdown.trim() || "(empty page)",
          ...(threads.length ? ["", "## Open comments", ...threads.map(threadSummary)] : []),
        ].join("\n"),
        MAX_READ_CHARS,
      );
    },
  });

  bb.agents.registerTool({
    name: "pages_create",
    description: "Create a BB Page from Markdown (GFM, chart/stats/embed/mermaid/html blocks, callouts, mentions; see studio skill). Local image paths in workspace/thread storage are imported. In this project unless global: true.",
    parameters: z.object({
      title: z.string().min(1).max(200),
      markdown: z.string().max(200_000).optional(),
      icon: z.string().max(16).optional().describe("One emoji"),
      parent: ref.optional(),
      global: z.boolean().optional(),
    }),
    async execute(params, ctx) {
      const { actor } = await service.actorForThread(ctx.threadId);
      const parent = params.parent ? service.requirePage(params.parent, ctx.projectId) : null;
      const { page, skipped } = await service.createPageImporting({
        projectId: params.global ? null : ctx.projectId,
        parentId: parent?.id ?? null,
        title: params.title,
        icon: params.icon,
        markdown: params.markdown,
        actor: actor.key,
      }, threadImageReader(bb, ctx.threadId));
      created(page.id, ctx.threadId);
      return [`Created page "${page.title}" (id ${page.id}). The user can open it at ${pageUrl(page.id)}.`, skippedNote(skipped), pageCard(page.id)].filter(Boolean).join("\n");
    },
  });

  bb.agents.registerTool({
    name: "pages_edit",
    description: "Edit a BB Page live with targeted ops (insert_after/insert_before/replace/delete/set_checked/append/prepend/replace_text/replace_all), or update title/icon.",
    parameters: z.object({
      page: ref,
      ops: z.array(opSchema).max(100).default([]),
      title: z.string().max(200).optional(),
      icon: z.string().max(16).optional(),
    }),
    async execute(params, ctx) {
      const meta = service.requirePage(params.page, ctx.projectId);
      const { actor } = await service.actorForThread(ctx.threadId);
      try {
        const result = params.ops.length
          ? await service.editImporting(meta.id, params.ops as EditOp[], actor, threadImageReader(bb, ctx.threadId))
          : { changed: false, touched: [], skipped: [] };
        if (params.title !== undefined || params.icon !== undefined) {
          store.update(meta.id, { title: params.title, icon: params.icon }, actor.key);
          service.publish({ type: "tree", projectId: meta.project_id });
        }
        const touched = result.touched.map((id) => `^${shortId(id)}`).join(", ");
        const header = params.title !== undefined || params.icon !== undefined;
        if (!result.changed && !header) return "Nothing changed; the page already matched.";
        if (ctx.threadId) edited(meta.id, ctx.threadId);
        return [result.changed
          ? `Updated "${params.title ?? meta.title}".${touched ? ` Changed blocks: ${touched}.` : ""}`
          : "Updated the page header; the content was already as requested.", skippedNote(result.skipped), pageCard(meta.id)].filter(Boolean).join("\n");
      } catch (error) {
        return { content: [{ type: "text", text: `Edit failed, nothing was changed: ${errorText(error)}` }], isError: true };
      }
    },
  });

  bb.agents.registerTool({
    name: "pages_comments",
    description: "Manage comment threads on a BB Page. op: list (default; includeResolved?), create (block, text, quote?), reply (thread, text), resolve (thread, resolved? default true).",
    parameters: z.object({
      page: ref,
      op: z.enum(["list", "create", "reply", "resolve"]).default("list"),
      includeResolved: z.boolean().optional(),
      block: block.optional(),
      quote: z.string().max(500).optional().describe("Exact text in the block to highlight; defaults to whole block"),
      thread: z.string().min(1).optional(),
      text: z.string().min(1).max(8000).optional(),
      resolved: z.boolean().optional(),
    }),
    async execute(params, ctx) {
      const meta = service.requirePage(params.page, ctx.projectId);
      const op = params.op ?? "list";
      if (op === "list") {
        const threads = listThreads(service.hub.open(meta.id).doc, { includeResolved: params.includeResolved });
        return threads.length ? truncate(threads.map(threadSummary).join("\n"), MAX_READ_CHARS) : "No comments.";
      }
      const { actor } = await service.actorForThread(ctx.threadId);
      const live = service.hub.open(meta.id);
      try {
        if (op === "create") {
          if (!params.block || !params.text) return opNeeds("create", ["block", "text"]);
          const { threadId, blockId } = await createThread(live.doc, actor.key, { block: params.block, text: params.text, quote: params.quote }, actor.key);
          service.hub.showPresence(live, actor, blockId);
          return `Started comment thread ${threadId} on block ^${shortId(blockId)}.`;
        }
        if (!params.thread) return opNeeds(op, op === "reply" ? ["thread", "text"] : ["thread"]);
        if (op === "reply") {
          if (!params.text) return opNeeds("reply", ["thread", "text"]);
          reply(live.doc, actor.key, params.thread, params.text, actor.key);
          const anchor = listThreads(live.doc, { includeResolved: true }).find((thread) => thread.id === params.thread);
          service.hub.showPresence(live, actor, anchor?.blockId ?? null);
          return "Replied.";
        }
        const resolved = params.resolved ?? true;
        setResolved(live.doc, actor.key, params.thread, resolved, actor.key);
        return resolved ? "Resolved." : "Reopened.";
      } catch (error) {
        return { content: [{ type: "text", text: errorText(error) }], isError: true };
      }
    },
  });
}

/** What `bb.agents.configure` gives a thread: Pages' tools and instructions. */
/** Pages' agent tools, which Studio configures in every session with its other kinds'. */
export const PAGE_TOOLS: readonly string[] = TOOL_NAMES;

function threadSummary(thread: ThreadView): string {
  const head = `- Thread ${thread.id}${thread.resolved ? " (resolved)" : ""}${thread.blockId ? ` on ^${shortId(thread.blockId)}` : ""}${thread.quote ? ` "${truncate(thread.quote, 120)}"` : ""}`;
  const comments = thread.comments.map((comment) => `  - ${authorLabel(comment.author)}: ${truncate(comment.text, 800)}`);
  return [head, ...comments].join("\n");
}

export function authorLabel(author: string): string {
  if (author === "user") return "User";
  if (author.startsWith("bot:")) return `Bot ${author.slice(4)}`;
  if (author.startsWith("agent:")) return `Agent (${author.slice(6)})`;
  return author;
}
