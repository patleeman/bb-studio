import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Bots } from "../bot";
import type { HubItem, StudioHub } from "../hub";
import { ITEM_FAMILIES, ITEM_TYPES } from "../item-model";
import { relativeTime, untitled } from "../kit/format";
import type { ProjectLeads } from "../project-lead";
import { compileQuery, parseQuery, type Filter, type Query } from "../query";
import type { Tag } from "../tags";

const MAX_LISTED = 100;

/** `snippet` is the content that matched a query, when the add-on gave it. */
export type ListedItem = HubItem & { tags: string[]; snippet?: string };

type HubOverview = Awaited<ReturnType<StudioHub["overview"]>>;
export type OverviewData = Omit<HubOverview, "items" | "truncated" | "discoveryComplete"> & {
  items: (HubOverview["items"][number] & { tags: string[]; starredAt?: number | null })[];
  tags: Tag[];
};

export interface ListToolsDeps {
  bb: BbPluginApi;
  bots: Bots;
  projectLeads: ProjectLeads;
  conversationBot: (threadId: string | undefined) => string | null | undefined;
  overview: () => Promise<OverviewData>;
  contentSearch: (query: string, keys: string[]) => Promise<{ keys: string[]; snippets: Record<string, string> }>;
}

/** Registers `studio_list_items` and returns the shared `listItems` / `formatList` helpers for the CLI. */
export function registerListTools({
  bb,
  bots,
  projectLeads,
  conversationBot,
  overview,
  contentSearch,
}: ListToolsDeps) {
  const itemLine = (item: ListedItem, kindLabel: string, tagNames: Map<string, string>) =>
    `- ${item.icon ? `${item.icon} ` : ""}${untitled(item.title)} — ${kindLabel}${item.archived ? ", archived" : ""}, ${
      item.projectId ? "project" : "global"
    }, updated ${relativeTime(item.updatedAt)}${item.tags.map((id) => ` #${tagNames.get(id) ?? id}`).join("")} (${item.href})${
      item.snippet ? `\n  > ${item.snippet}` : ""
    }`;

  /** The values a query can name, with every field's names for an error. */
  const vocabulary = async (data: OverviewData) => ({
    kinds: data.providers.flatMap((provider) => provider.kinds),
    projects: (await bb.sdk.projects.list().catch(() => [])).map((project) => ({ id: project.id, name: project.name })),
    tags: data.tags,
  });

  const unknownFilter = (filter: Filter, names: Awaited<ReturnType<typeof vocabulary>>) => {
    const known = {
      kind: names.kinds.map((kind) => kind.id),
      family: ITEM_FAMILIES.map((family) => family.id as string),
      type: ITEM_TYPES.map((type) => type.type as string),
      project: ["global", ...names.projects.map((project) => project.name)],
      tag: ["none", ...names.tags.map((tag) => tag.name)],
      is: ["archived", "template", "starred"],
    }[filter.field];
    return new Error(`No ${filter.field} called "${filter.value}". Try: ${known.join(", ") || "none yet"}.`);
  };

  /**
   * Lists items matching a query (src/query.ts). Without `all` or a project
   * filter, it's the thread's project's items and global ones; the Chief of
   * Staff sees every project.
   */
  const listItems = async (options: { projectId: string | null; threadId?: string; all: boolean; query?: string; kind?: string; tag?: string }) => {
    const data = await overview();
    const names = await vocabulary(data);
    const parsed: Query = parseQuery(options.query ?? "");
    for (const [field, value] of [["kind", options.kind], ["tag", options.tag]] as const) {
      if (value) parsed.filters.push({ field, value });
    }
    const compiled = compileQuery(parsed, names);
    if (compiled.unknown.length) throw unknownFilter(compiled.unknown[0]!, names);
    const named = parsed.filters.some((filter) => !filter.negate && filter.field === "project");
    const everything = named || options.all || (options.threadId !== undefined && (projectLeads.chiefThreadId() === options.threadId || !!bots.forThread(options.threadId) || !!conversationBot(options.threadId)));
    const inScope = (item: HubItem) => everything || item.projectId === null || item.projectId === options.projectId;
    const labels = new Map(data.providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind.label])));
    const text = compiled.text.toLowerCase();
    const eligible = data.items.filter((item) => inScope(item) && compiled.test(item));
    const content = compiled.text ? await contentSearch(compiled.text, eligible.map((item) => `${item.pluginId}:${item.id}`)) : null;
    const contentKeys = new Set(content?.keys);
    const picked: ListedItem[] = eligible
      .filter(
        (item) =>
          (!text || untitled(item.title).toLowerCase().includes(text) || contentKeys.has(`${item.pluginId}:${item.id}`)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => {
        const snippet = content?.snippets[`${item.pluginId}:${item.id}`];
        return snippet ? { ...item, snippet } : item;
      });
    const problems = data.providers.filter((provider) => provider.state !== "ready").map((provider) => `${provider.name}: ${provider.detail}`);
    const tagNames = new Map(data.tags.map((each) => [each.id, each.name]));
    return { picked, labels, problems, tagNames };
  };

  const formatList = ({ picked, labels, problems, tagNames }: Awaited<ReturnType<typeof listItems>>) => {
    const lines = picked.slice(0, MAX_LISTED).map((item) => itemLine(item, labels.get(`${item.pluginId}:${item.kind}`) ?? item.kind, tagNames));
    if (picked.length > MAX_LISTED) lines.push(`…and ${picked.length - MAX_LISTED} more. Narrow the query.`);
    if (!lines.length) lines.push("No Studio items match.");
    if (problems.length) lines.push("", "Unavailable:", ...problems.map((problem) => `- ${problem}`));
    return lines.join("\n");
  };

  bb.agents.registerTool({
    name: "studio_list_items",
    description:
      "List the user's BB Studio items — pages (docs, designs, whiteboards), apps (mini apps, artifacts), Talk recordings and anything else a Studio add-on provides — newest first. It lists this thread's project's items and global ones (the user's Bot, the personal project's lead, sees every project); a project: filter or allProjects lists beyond that. Each line has a link and the item's #tags, and a content match shows the text that matched; open or mention it to work with the item.",
    parameters: z.object({
      query: z
        .string()
        .max(500)
        .optional()
        .describe('Words match titles and content. Filters: family:<page|app> type:<doc|design|whiteboard|mini|artifact> kind:<kind> project:<name|global> tag:<name|none> is:archived is:template is:starred; quote names with spaces, repeat a field for any of its values, prefix - to exclude. E.g. kind:page -tag:draft project:"Q4 launch" pricing'),
      kind: z.string().max(100).optional().describe("Only this kind, e.g. page, recording, drawing; same as kind: in the query"),
      allProjects: z.boolean().optional().describe("Include every project, not just this one"),
      tag: z.string().max(100).optional().describe("Only items with this tag; same as tag: in the query"),
    }),
    async execute({ query, kind, allProjects, tag }, ctx) {
      return formatList(await listItems({ projectId: ctx.projectId ?? null, threadId: ctx.threadId, all: allProjects === true, kind, query, tag }));
    },
  });

  return { listItems, formatList };
}
