// Pages as a Studio add-on: the `studio_*` methods Studio calls to list and
// manage pages in its collection.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { copyTitle, eachId, fillTemplate, type StudioItem, type StudioKind, type StudioSchemas } from "@bb-studio/kit/contract";
import { untitled } from "@bb-studio/kit/format";
import { mustGet, registerStudioProvider, storeSearch } from "@bb-studio/kit/server";
import { HUMAN_USER_ID, PLUGIN_ID } from "./constants";
import { readMarkdown } from "./doc";
import type { PagesService } from "./service";
import type { PageMeta } from "./store";
import { pageHtml, pagePdf } from "./export-document";

export const PAGE_KIND: StudioKind = {
  id: "page",
  label: "Page",
  plural: "Pages",
  icon: "pages/pages",
  columns: [],
  actions: [{ id: "copy-markdown", label: "Copy as Markdown", icon: "Copy", result: "copy" }],
  create: { mode: "rpc" },
  canArchive: true,
  capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: true, export: true, comments: true, versions: true, links: true, templates: true },
  mentionProviderId: "page",

  blurb: "Documents you write with agents.",
  agentHint: "Read it with pages_read and change it with pages_edit; comments are in pages_comments.",
};

const PREVIEW_CHARS = 140;

/** A line of Markdown as plain text; empty for rules, tables and images. */
function plainLine(raw: string): string {
  const line = raw.trim();
  if (!line || /^(<!--.*-->|---+|\|.*\||!\[.*\]\(.*\))$/.test(line)) return "";
  return line
    .replace(/<!--.*?-->/g, "")
    .replace(/^(#{1,6}\s+|>\s*(\[!\w+\]\s*)?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
    .replace(/@\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, "$2")
    .trim();
}

/** The first line of prose in a page, without Markdown syntax. */
export function excerpt(markdown: string): string | null {
  let fenced = false;
  for (const raw of markdown.split("\n")) {
    if (raw.trim().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    const text = fenced ? "" : plainLine(raw);
    if (text) return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : text;
  }
  return null;
}

/** Fenced blocks that hold block settings as JSON rather than text. */
const DATA_FENCES = new Set(["chart", "stats", "embed"]);

/** A page's text for search snippets: every line, code included, without Markdown syntax or block settings. */
export function plainText(markdown: string): string {
  let data = false;
  return markdown
    .split("\n")
    .map((raw) => {
      const line = raw.trim();
      if (line.startsWith("```")) {
        data = !data && DATA_FENCES.has(line.slice(3).trim().split(/\s/)[0]!);
        return "";
      }
      return data ? "" : plainLine(raw);
    })
    .filter(Boolean)
    .join("\n");
}

export function toStudioItem(meta: PageMeta, markdown: string | null): StudioItem {
  return {
    id: meta.id,
    kind: PAGE_KIND.id,
    title: meta.title,
    icon: meta.icon || null,
    projectId: meta.project_id,
    parentId: meta.parent_id,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
    updatedBy: meta.updated_by === HUMAN_USER_ID ? "user" : meta.updated_by ? "agent" : null,
    preview: markdown === null ? null : excerpt(markdown),
    facts: [],
    badge: meta.refresh_bot_id && meta.refresh_cron ? { label: "Auto-refresh", tone: "neutral" } : null,
    thumbnailUrl: null,
    href: `/plugins/${PLUGIN_ID}/pages/${meta.id}`,
    archived: meta.archived_at !== null,
    template: Boolean(meta.template),
  };
}

export function registerStudio(bb: BbPluginApi, service: PagesService, schemas: StudioSchemas): void {
  const { store } = service;
  const requireMeta = (id: string) => mustGet((key) => store.meta(key), id, "Page not found.");
  const duplicate = (id: string, projectId: string | null, includeChildren: boolean, variables?: Record<string, string>): StudioItem => {
    const source = requireMeta(id);
    const render = (value: string) => variables ? fillTemplate(value, variables) : value;
    const make = (pageId: string, parentId: string | null): StudioItem => {
      const page = requireMeta(pageId);
      const created = service.createPage({ projectId, parentId, title: render(variables ? page.title : copyTitle(page.title)), icon: page.icon,
        markdown: render(store.get(pageId)?.markdown ?? ""), actor: HUMAN_USER_ID });
      let markdown = store.get(created.id)?.markdown ?? "";
      for (const file of store.files(pageId)) {
        const nextId = store.addFile(created.id, file.name, file.mime, file.data);
        markdown = markdown.replaceAll(`?id=${file.id}`, `?id=${nextId}`);
      }
      if (markdown !== (store.get(created.id)?.markdown ?? "")) service.replaceMarkdown(created.id, markdown, "Copied attachments", { key: HUMAN_USER_ID, name: "You", color: "#666666" });
      if (includeChildren) for (const child of store.list({ includeArchived: false }).filter((entry) => entry.parent_id === pageId)) make(child.id, created.id);
      return toStudioItem(store.meta(created.id)!, store.get(created.id)?.markdown ?? "");
    };
    return make(source.id, null);
  };

  registerStudioProvider(bb, schemas, {
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: "pages", kinds: [PAGE_KIND] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const meta = store.meta(id); return meta ? [toStudioItem(meta, store.get(id)?.markdown ?? null)] : []; }) }),
    studio_read: ({ id, format }) => { const markdown = store.get(id)?.markdown ?? null; return { content: markdown === null ? null : format === "markdown" ? markdown : plainText(markdown) }; },
    studio_list: () => {
      const markdown = store.markdownHeads();
      return { items: store.list({ includeArchived: true }).map((meta) => toStudioItem(meta, markdown.get(meta.id) ?? null)) };
    },
    studio_search: storeSearch({
      find: (query) => store.search(query, undefined, 200),
      text: (meta) => plainText(store.get(meta.id)?.markdown ?? ""),
    }),
    studio_create: ({ projectId }) => ({
      item: toStudioItem(service.createPage({ projectId, parentId: null, title: "", actor: HUMAN_USER_ID }), ""),
    }),
    studio_duplicate: ({ id, projectId, includeChildren }) => ({ item: duplicate(id, projectId, includeChildren === true) }),
    studio_template: ({ id, template }) => { const page = requireMeta(id); store.setTemplate(id, template); service.publish({ type: "tree", projectId: page.project_id }); return { item: toStudioItem(requireMeta(id), store.get(id)?.markdown ?? "") }; },
    studio_instantiate: ({ id, projectId, variables }) => { if (!requireMeta(id).template) throw new Error("Page is not a template."); return { item: duplicate(id, projectId, true, variables) }; },
    studio_export: async ({ id, format }) => {
      const page = requireMeta(id);
      let markdown = store.get(id)?.markdown ?? "";
      const name = page.title.trim() || "Untitled page";
      const assets = store.files(id).map((file) => {
        const assetName = `assets/${file.id}-${file.name.replace(/[/\\]/g, "_")}`;
        markdown = markdown.replaceAll(`/api/v1/plugins/pages/http/files?id=${file.id}`, assetName);
        return { name: assetName, mime: file.mime, data: file.data.toString("base64") };
      });
      if (format === "markdown") return { files: [{ name: `${name}.md`, mime: "text/markdown", data: Buffer.from(markdown).toString("base64") }, ...assets] };
      if (format === "html") {
        const html = pageHtml(name, markdown);
        return { files: [{ name: `${name}.html`, mime: "text/html", data: Buffer.from(html).toString("base64") }, ...assets] };
      }
      if (format === "pdf") return { files: [{ name: `${name}.pdf`, mime: "application/pdf", data: Buffer.from(await pagePdf(name, markdown)).toString("base64") }] };
      throw new Error(`Unsupported page format: ${format}`);
    },
    studio_move: ({ ids, projectId }) => {
      const touched = new Set<string | null>([projectId]);
      const result = eachId(ids, (id) => {
        const meta = requireMeta(id);
        touched.add(meta.project_id);
        // A page leaves a parent that stays behind in the old project.
        const parent = meta.parent_id ? store.meta(meta.parent_id) : null;
        const detach = parent && !ids.includes(parent.id) && parent.project_id !== projectId;
        store.update(id, { project_id: projectId, ...(detach ? { parent_id: null } : {}) }, HUMAN_USER_ID);
        for (const child of store.descendants(id)) store.update(child, { project_id: projectId }, HUMAN_USER_ID);
      });
      return result.finally(() => {
        for (const project of touched) service.publish({ type: "tree", projectId: project });
      });
    },
    studio_archive: ({ ids, archived }) =>
      eachId(ids, (id) => {
        const meta = requireMeta(id);
        store.update(id, { archived_at: archived ? Date.now() : null }, HUMAN_USER_ID);
        service.publish({ type: "tree", projectId: meta.project_id });
      }),
    studio_rename: ({ id, title }) =>
      eachId([id], () => {
        const meta = requireMeta(id);
        store.update(id, { title }, HUMAN_USER_ID);
        service.publish({ type: "tree", projectId: meta.project_id });
      }),
    studio_delete: ({ ids }) => {
      const gone = new Set<string>();
      return eachId(ids, (id) => {
        // Deleting a parent takes its sub-pages with it.
        if (gone.has(id)) return;
        requireMeta(id);
        for (const deleted of service.deletePage(id)) gone.add(deleted);
      });
    },
    studio_action: ({ action, ids }) => {
      if (action !== "copy-markdown") throw new Error(`Unknown action "${action}".`);
      const pages = ids.map((id) => {
        const meta = requireMeta(id);
        const markdown = readMarkdown(service.hub.open(id).doc);
        return ids.length === 1 ? markdown : `# ${meta.icon ? `${meta.icon} ` : ""}${untitled(meta.title)}\n\n${markdown}`;
      });
      return { message: ids.length === 1 ? "Copied as Markdown" : `Copied ${ids.length} pages as Markdown`, text: pages.join("\n\n---\n\n") };
    },
  });
}
