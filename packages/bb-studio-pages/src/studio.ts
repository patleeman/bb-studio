// Pages as a Studio add-on: the `studio_*` methods Studio calls to list and
// manage pages in its collection.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { eachId, type StudioItem, type StudioKind, type StudioSchemas } from "@bb-studio/kit/contract";
import { snippets } from "@bb-studio/kit/format";
import { registerStudioProvider } from "@bb-studio/kit/server";
import { HUMAN_USER_ID, PLUGIN_ID } from "./constants";
import { readMarkdown } from "./doc";
import type { PagesService } from "./service";
import type { PageMeta } from "./store";

export const PAGE_KIND: StudioKind = {
  id: "page",
  label: "Page",
  plural: "Pages",
  icon: "pages/pages",
  columns: [],
  actions: [{ id: "copy-markdown", label: "Copy as Markdown", icon: "Copy", result: "copy" }],
  create: { mode: "rpc" },
  canArchive: true,
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

/** A page's text for search snippets: every line, code included, without Markdown syntax. */
export function plainText(markdown: string): string {
  return markdown
    .split("\n")
    .map((raw) => (raw.trim().startsWith("```") ? "" : plainLine(raw)))
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
  };
}

export function registerStudio(bb: BbPluginApi, service: PagesService, schemas: StudioSchemas): void {
  const { store } = service;
  const requireMeta = (id: string) => {
    const meta = store.meta(id);
    if (!meta) throw new Error("Page not found.");
    return meta;
  };

  registerStudioProvider(bb, schemas, {
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 1, panel: "pages", kinds: [PAGE_KIND] }),
    studio_list: () => {
      const markdown = store.markdownHeads();
      return { items: store.list({ includeArchived: true }).map((meta) => toStudioItem(meta, markdown.get(meta.id) ?? null)) };
    },
    studio_search: ({ query }) => {
      const found = store.search(query, undefined, 200);
      return {
        ids: found.map((meta) => meta.id),
        snippets: snippets(found, query, (meta) => plainText(store.get(meta.id)?.markdown ?? "")),
      };
    },
    studio_create: ({ projectId }) => ({
      item: toStudioItem(service.createPage({ projectId, parentId: null, title: "", actor: HUMAN_USER_ID }), ""),
    }),
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
        return ids.length === 1 ? markdown : `# ${meta.icon ? `${meta.icon} ` : ""}${meta.title || "Untitled"}\n\n${markdown}`;
      });
      return { message: ids.length === 1 ? "Copied as Markdown" : `Copied ${ids.length} pages as Markdown`, text: pages.join("\n\n---\n\n") };
    },
  });
}
