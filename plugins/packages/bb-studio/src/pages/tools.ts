import { untitled } from "../kit/format";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { callText, counted, nextLine, pageByKey, pageItems, staleCursor } from "../paging";
import { createThread, listThreads, reply, setResolved, type ThreadView } from "./comments";
import { readMarkdown, type EditOp } from "./doc";
import { shortId } from "./markdown";
import { threadImageReader } from "./local-image-reader";
import { skippedNote } from "./local-images";
import { errorText, pageUrl, truncate, type PagesService } from "./service";
import type { PageMeta } from "./store";
import { opNeeds } from "../op-errors";

const MAX_READ_CHARS = 60_000;
/** pages_read's default part of a long page (characters); `limit` asks for more, up to MAX_READ_CHARS. */
const SEARCH_CAP = 200;
export const READ_PART_CHARS = 12_000;

/**
 * One part of a page's Markdown, from block `from` (an id or its prefix) on, whole blocks only, at most
 * `limit` characters; `next` is the first block left out. A single block larger than `limit` is cut at
 * `limit` characters (`cut`). A `from` that matches no block gives `missing`: the block was deleted.
 */
export function readPart(markdown: string, from: string | undefined, limit: number): { text: string; next: string | null; shown: number; total: number; cut?: { block: string; size: number }; missing?: true } {
  const marker = /^<!-- \^([A-Za-z0-9_-]+) -->/gm;
  const starts: { at: number; id: string }[] = [];
  for (const match of markdown.matchAll(marker)) starts.push({ at: match.index!, id: match[1]! });
  if (!starts.length) return { text: markdown.slice(0, limit), next: null, shown: Math.min(markdown.length, limit), total: markdown.length };
  const blocks = starts.map((start, index) => ({ id: start.id, text: markdown.slice(start.at, starts[index + 1]?.at ?? markdown.length) }));
  const lead = markdown.slice(0, starts[0]!.at);
  const first = from ? blocks.findIndex((block) => block.id.startsWith(from)) : 0;
  if (first < 0) return { text: "", next: null, shown: 0, total: markdown.length, missing: true };
  const out: string[] = first === 0 && lead ? [lead] : [];
  let size = out.join("").length;
  let index = first;
  while (index < blocks.length && size + blocks[index]!.text.length <= limit) {
    out.push(blocks[index]!.text);
    size += blocks[index]!.text.length;
    index++;
  }
  if (index === first) {
    // One block larger than the whole part: its first `limit` characters, and say so.
    const block = blocks[first]!;
    const room = Math.max(0, limit - size);
    out.push(block.text.slice(0, room));
    return { text: out.join(""), next: blocks[first + 1]?.id ?? null, shown: size + room, total: markdown.length, cut: { block: block.id, size: block.text.length } };
  }
  return { text: out.join(""), next: blocks[index]?.id ?? null, shown: size, total: markdown.length };
}

export const TOOL_NAMES = [
  "pages_list",
  "pages_read",
  "pages_create",
  "pages_edit",
  "pages_comments",
] as const;

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
    parameters: z.object({ query: z.string().max(200).optional(), after: z.string().min(1).max(512).optional().describe("The cursor the last part's Next names") }),
    execute({ query, after }, ctx) {
      // In parts (src/paging.ts): the next part starts after the last page shown.
      const parted = (rows: { id: string; line: string }[], heading: string) => {
        const part = pageItems(rows, (row) => row.id, (row) => row.line.length, { after });
        if (part.missing) return staleCursor(`Page ${after}`, callText("pages_list", { ...(query?.trim() ? { query } : {}) }));
        const next = nextLine(part, (last) => callText("pages_list", { ...(query?.trim() ? { query } : {}), after: last }), "pages");
        return [heading, ...(next ? [next] : []), ...part.items.map((row) => row.line)].join("\n");
      };
      if (query?.trim()) {
        // Search hits by keyset on creation: a page edited between parts doesn't move.
        const hits = store.search(query, ctx.projectId, SEARCH_CAP, "created");
        if (!hits.length) return `No pages match "${query}".`;
        const part = pageByKey(hits, (page) => [page.created_at, page.id], (page) => pageLine(page).length, { after, descending: [true, true] });
        if (part.missing) return staleCursor("That cursor", callText("pages_list", { query }));
        const next = nextLine(part, (last) => callText("pages_list", { query, after: last }), "pages");
        return [`${counted(hits.length, SEARCH_CAP)} page${hits.length === 1 ? "" : "s"} match, newest first.`, ...(next ? [next] : []), ...part.items.map((page) => pageLine(page))].join("\n");
      }
      const pages = store.list({ projectId: ctx.projectId });
      if (!pages.length) return "No pages yet. Create one with pages_create.";
      const children = new Map<string | null, PageMeta[]>();
      for (const page of pages) {
        const parent = page.parent_id && pages.some((p) => p.id === page.parent_id) ? page.parent_id : null;
        children.set(parent, [...(children.get(parent) ?? []), page]);
      }
      const lines: { id: string; line: string }[] = [];
      const walk = (parent: string | null, depth: number) => {
        for (const page of children.get(parent) ?? []) {
          lines.push({ id: page.id, line: pageLine(page, depth) });
          walk(page.id, depth + 1);
        }
      };
      walk(null, 0);
      return parted(lines, `${lines.length} page${lines.length === 1 ? "" : "s"}.`);
    },
  });

  bb.agents.registerTool({
    name: "pages_read",
    description: `Read a BB Page as Markdown with \`<!-- ^id -->\` block ids and open comments. Read right before pages_edit. A long page comes in parts of about ${READ_PART_CHARS.toLocaleString("en-US")} characters: the next part with from (the block id it names), or more at once with limit.`,
    parameters: z.object({
      page: ref,
      from: z.string().trim().min(1).max(64).optional().describe("Block id (or prefix) to start from: the next part of a long page"),
      limit: z.number().int().min(1_000).max(MAX_READ_CHARS).optional().describe(`Characters to read (default ${READ_PART_CHARS})`),
    }),
    execute({ page, from, limit }, ctx) {
      const meta = service.requirePage(page, ctx.projectId);
      const live = service.hub.open(meta.id);
      const markdown = readMarkdown(live.doc, { ids: true }).trim();
      const header = [
        `# ${meta.icon ? `${meta.icon} ` : ""}${untitled(meta.title)}`,
        `Page id ${meta.id} · ${meta.project_id ? "project page" : "global page"} · ${pageUrl(meta.id)}`,
      ];
      // The header and the Next line stay inside MAX_READ_CHARS whatever limit asks for.
      const budget = Math.min(limit ?? READ_PART_CHARS, MAX_READ_CHARS - header.join("\n").length - 600);
      const part = readPart(markdown, from, budget);
      if (part.missing) return `Block ${from} is no longer on page ${meta.id}. Start again: ${callText("pages_read", { page: meta.id })}.`;
      const threads = listThreads(live.doc);
      const last = part.next === null;
      const notes = [
        ...(part.cut ? [`(Block ${part.cut.block} is ${part.cut.size.toLocaleString("en-US")} characters, more than one part holds: it is cut after the first ${part.shown.toLocaleString("en-US")}.)`] : []),
        ...(last ? [] : [`(Part: ${part.shown.toLocaleString("en-US")} of ${part.total.toLocaleString("en-US")} characters. Next: pages_read { page: "${meta.id}", from: "${part.next}" }.)`]),
      ];
      return truncate(
        [
          ...header,
          ...notes,
          "",
          part.text.trim() || "(empty page)",
          ...(last && threads.length ? ["", "## Open comments", ...threads.map(threadSummary)] : []),
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
